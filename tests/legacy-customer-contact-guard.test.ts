import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Prisma } from "../app/generated/prisma/client";
import { claimFittingSync, releaseFittingSync } from "../lib/ghl/fittingSyncClaim";

test("disabled customer sync never creates contacts or bypasses fitting claims", async () => {
  const originalPrisma = Object.getOwnPropertyDescriptor(globalThis, "prisma");
  const originalFetch = globalThis.fetch;
  const keys = ["GHL_CUSTOMER_CONTACT_SYNC_ENABLED", "GHL_SWINGLOCKER_LOCATION_ID", "GHL_SWINGLOCKER_PRIVATE_TOKEN"] as const;
  const env = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    GHL_CUSTOMER_CONTACT_SYNC_ENABLED: "false",
    GHL_SWINGLOCKER_LOCATION_ID: "location",
    GHL_SWINGLOCKER_PRIVATE_TOKEN: "test-token",
  });
  after(() => {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
    if (originalPrisma) Object.defineProperty(globalThis, "prisma", originalPrisma);
    else Reflect.deleteProperty(globalThis, "prisma");
  });

  const client = {
    id: 3, firstName: "Ann", lastName: "Lee", email: "ann@example.test", phone: null,
    ghlContactId: "contact" as string | null, ghlContactCreationState: null as unknown,
    syncState: null as null | { creationAttemptStatus: string },
    ghlSyncStatus: null as string | null, ghlSyncError: null as string | null,
  };
  const sessions = new Map([
    [7, { id: 7, clientId: 3, ghlSyncState: null as unknown }],
    [8, { id: 8, clientId: 3, ghlSyncState: null as unknown }],
  ]);
  let tail = Promise.resolve();
  const fake = {
    async $transaction<T>(fn: (tx: object) => Promise<T>): Promise<T> {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try { return await fn(this); } finally { release(); }
    },
    async $queryRaw(strings: TemplateStringsArray) {
      if (strings.join("?").includes("FROM GolfClientSyncState")) return [];
      if (strings.join("?").includes("SELECT id, ghlSyncState")) {
        return [...sessions.values()].map((row) => structuredClone(row));
      }
      return [{ id: 3 }];
    },
    golfClient: {
      async findUnique() { return structuredClone(client); },
      async findMany() { return []; },
      async update({ data }: { data: Record<string, unknown> }) { Object.assign(client, data); },
    },
    demoSession: {
      async findFirst() {
        const first = [...sessions.values()].sort((a, b) => a.id - b.id)[0];
        return first ? { id: first.id } : null;
      },
      async findUnique({ where }: { where: { id: number } }) {
        const row = sessions.get(where.id);
        return row ? { clientId: row.clientId } : null;
      },
      async findUniqueOrThrow({ where }: { where: { id: number } }) {
        const row = sessions.get(where.id);
        if (!row) throw new Error("session missing");
        return structuredClone(row);
      },
      async update({ where, data }: { where: { id: number }; data: { ghlSyncState: unknown } }) {
        const row = sessions.get(where.id)!;
        row.ghlSyncState = data.ghlSyncState === Prisma.DbNull ? null : structuredClone(data.ghlSyncState);
      },
    },
  };
  Object.defineProperty(globalThis, "prisma", { configurable: true, writable: true, value: fake });
  const requests: string[] = [];
  let pauseUpdate: (() => Promise<void>) | null = null;
  let failUpdate = false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    requests.push(`${method} ${url.pathname}`);
    const contact = { id: "contact", locationId: "location", firstName: "Ann", lastName: "Lee", email: "ann@example.test" };
    if (url.pathname === "/contacts/lookup") return Response.json({ contacts: [contact] });
    if (url.pathname === "/contacts/contact" && method === "GET") return Response.json({ contact });
    if (url.pathname === "/contacts/contact" && method === "PUT") {
      if (pauseUpdate) await pauseUpdate();
      if (failUpdate) throw new Error("response timed out");
      return Response.json({ contact });
    }
    if (url.pathname === "/contacts/contact/tags" && method === "POST") return Response.json({});
    throw new Error(`Unexpected mocked request: ${method} ${url.pathname}`);
  };

  const { syncGolfClientContact } = await import("../lib/ghl/syncGolfClientContact");
  client.ghlContactId = null;
  await syncGolfClientContact(3);
  assert.equal(requests.length, 0);
  assert.match(client.ghlSyncError!, /no saved GHL contact/i);

  client.ghlContactId = "contact";
  for (const marker of [
    { ghlContactCreationState: { status: "creating" }, syncState: null },
    { ghlContactCreationState: null, syncState: { creationAttemptStatus: "unknown" } },
  ]) {
    Object.assign(client, marker);
    await syncGolfClientContact(3);
    assert.equal(requests.length, 0);
    assert.match(client.ghlSyncError!, /reconciliation/i);
  }
  Object.assign(client, { ghlContactCreationState: null, syncState: null });
  sessions.get(8)!.ghlSyncState = JSON.stringify({ version: 1, fittingClaim: { token: "interrupted" } });
  await syncGolfClientContact(3);
  assert.equal(requests.length, 0);
  assert.match(client.ghlSyncError!, /reconciliation/i);
  assert.equal(sessions.get(7)!.ghlSyncState, null);

  sessions.get(8)!.ghlSyncState = null;
  let start!: () => void;
  let resume!: () => void;
  const started = new Promise<void>((resolve) => { start = resolve; });
  const paused = new Promise<void>((resolve) => { resume = resolve; });
  pauseUpdate = async () => { start(); await paused; };
  const update = syncGolfClientContact(3);
  await started;
  assert.equal(await claimFittingSync(fake as never, 8), null);
  resume();
  await update;
  assert.equal(client.ghlSyncStatus, "synced");
  assert.equal(sessions.get(7)!.ghlSyncState, null);
  assert.equal(requests.filter((request) => request === "PUT /contacts/contact").length, 1);
  assert.equal(requests.filter((request) => request === "POST /contacts").length, 0);
  const [first, second] = await Promise.all([
    claimFittingSync(fake as never, 7), claimFittingSync(fake as never, 8),
  ]);
  assert.equal([first, second].filter(Boolean).length, 1);
  if (first) await releaseFittingSync(fake as never, 7, first);
  if (second) await releaseFittingSync(fake as never, 8, second);

  pauseUpdate = null;
  failUpdate = true;
  await syncGolfClientContact(3);
  assert.ok(sessions.get(7)!.ghlSyncState);
  assert.equal(await claimFittingSync(fake as never, 8), null);
  const puts = requests.filter((request) => request === "PUT /contacts/contact").length;
  await syncGolfClientContact(3);
  assert.equal(requests.filter((request) => request === "PUT /contacts/contact").length, puts);
  assert.equal(requests.filter((request) => request === "POST /contacts").length, 0);

  sessions.clear();
  failUpdate = false;
  await syncGolfClientContact(3);
  assert.equal(client.ghlSyncStatus, "synced");
  assert.equal(requests.filter((request) => request === "PUT /contacts/contact").length, puts + 1);
});
