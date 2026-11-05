import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "../app/generated/prisma/client";
import { CreationNeedsReconciliationError } from "../lib/ghl/syncStagedFitting";
import { createPrismaStagedSyncDeps } from "../lib/ghl/syncStagedFittingStore";

interface FakeClient {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  ghlContactId: string | null;
  ghlContactCreationState: unknown;
}

interface FakeSession {
  id: number;
  ghlSyncState: unknown;
  ghlSyncStatus: string | null;
  ghlSyncError: string | null;
}

function fakeDatabase() {
  const client: FakeClient = {
    id: 3,
    firstName: "Ann",
    lastName: "Lee",
    email: "ann@example.com",
    phone: null,
    ghlContactId: null,
    ghlContactCreationState: null,
  };
  const sessions = new Map<number, FakeSession>([
    [7, { id: 7, ghlSyncState: null, ghlSyncStatus: null, ghlSyncError: null }],
    [8, { id: 8, ghlSyncState: null, ghlSyncStatus: null, ghlSyncError: null }],
  ]);
  const sql: string[] = [];
  let tail: Promise<void> = Promise.resolve();
  let transactionDepth = 0;

  const db = {
    async $transaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      transactionDepth++;
      try {
        return await fn(db as never);
      } finally {
        transactionDepth--;
        release();
      }
    },
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> {
      void values;
      sql.push(strings.join("?"));
      return [];
    },
    golfClient: {
      async findUniqueOrThrow() {
        return { ...client };
      },
      async findUnique() {
        return { id: client.id };
      },
      async update(args: {
        data: Partial<FakeClient> & { ghlContactCreationState?: unknown };
      }) {
        const state = args.data.ghlContactCreationState;
        Object.assign(client, args.data);
        if (state === Prisma.DbNull) client.ghlContactCreationState = null;
        return client;
      },
      async updateMany(args: {
        where: { id: number; OR: { ghlContactId: string | null }[] };
        data: { ghlContactId: string; ghlContactCreationState?: unknown };
      }) {
        if (
          args.where.id !== client.id ||
          !args.where.OR.some((condition) => condition.ghlContactId === client.ghlContactId)
        ) {
          return { count: 0 };
        }
        client.ghlContactId = args.data.ghlContactId;
        if (args.data.ghlContactCreationState === Prisma.DbNull) {
          client.ghlContactCreationState = null;
        }
        return { count: 1 };
      },
    },
    demoSession: {
      async findUniqueOrThrow(args: { where: { id: number } }) {
        const session = sessions.get(args.where.id);
        if (!session) throw new Error("session not found");
        return { ...session };
      },
      async update(args: {
        where: { id: number };
        data: Partial<FakeSession> & { ghlSyncState?: unknown };
      }) {
        const session = sessions.get(args.where.id);
        if (!session) throw new Error("session not found");
        Object.assign(session, args.data);
        if (args.data.ghlSyncState === Prisma.DbNull) session.ghlSyncState = null;
        return session;
      },
    },
    ghlSyncEvent: {
      async create() {
        return { id: 1 };
      },
    },
  };
  return {
    db,
    client,
    sessions,
    sql,
    get transactionActive() {
      return transactionDepth > 0;
    },
  };
}

function installFakeGhlApi(opts: { loseCreateResponse?: boolean; delayCreate?: boolean } = {}) {
  const originalFetch = globalThis.fetch;
  const contacts = new Map<string, Record<string, unknown>>();
  let creates = 0;
  let onCreate: () => void = () => {};
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/contacts/lookup") {
      const email = url.searchParams.get("email");
      const phone = url.searchParams.get("phone");
      const matches = [...contacts.values()].filter(
        (contact) =>
          (email !== null && contact.email === email) ||
          (phone !== null && contact.phone === phone),
      );
      return Response.json({ contacts: matches });
    }
    if (url.pathname === "/contacts" && init?.method === "POST") {
      creates++;
      onCreate();
      const inputBody = JSON.parse(String(init.body)) as Record<string, unknown>;
      const id = "contact-created";
      contacts.set(id, {
        id,
        locationId: "loc-test",
        firstName: inputBody.firstName,
        lastName: inputBody.lastName,
        email: inputBody.email,
        phone: inputBody.phone,
      });
      if (opts.delayCreate) await new Promise((resolve) => setTimeout(resolve, 20));
      if (opts.loseCreateResponse) throw new Error("socket closed after remote create");
      return Response.json({ contact: { id } });
    }
    const id = decodeURIComponent(url.pathname.slice("/contacts/".length));
    const contact = contacts.get(id);
    if (contact) return Response.json({ contact });
    return Response.json({ message: "not found" }, { status: 404 });
  };
  process.env.GHL_SWINGLOCKER_PRIVATE_TOKEN = "test-token";
  process.env.GHL_SWINGLOCKER_LOCATION_ID = "loc-test";
  return {
    contacts,
    get creates() {
      return creates;
    },
    restore() {
      globalThis.fetch = originalFetch;
    },
    observeCreate(callback: () => void) {
      onCreate = callback;
    },
    loseCreateResponse(value: boolean) {
      opts.loseCreateResponse = value;
    },
  };
}

const contactInput = {
  firstName: "Ann",
  lastName: "Lee",
  email: "ann@example.com",
  phone: null,
};

function resolveArgs(sessionId: number) {
  return {
    sessionId,
    batchId: sessionId,
    clientId: 3,
    savedGhlContactId: null,
  };
}

test("different sessions for one customer cannot concurrently create two GHL contacts", async () => {
  const fake = fakeDatabase();
  const ghl = installFakeGhlApi({ delayCreate: true });
  const createSnapshot: {
    current: {
      transactionActive: boolean;
      customerClaim: unknown;
      sessionMarkers: unknown[];
    } | null;
  } = { current: null };
  let signalCreateStarted!: () => void;
  const createStarted = new Promise<void>((resolve) => {
    signalCreateStarted = resolve;
  });
  ghl.observeCreate(() => {
    createSnapshot.current = {
      transactionActive: fake.transactionActive,
      customerClaim: fake.client.ghlContactCreationState,
      sessionMarkers: [...fake.sessions.values()].map((session) => session.ghlSyncState),
    };
    signalCreateStarted();
  });
  try {
    const deps = createPrismaStagedSyncDeps(fake.db as never);
    const first = deps.resolveNewContact(contactInput, resolveArgs(7));
    await createStarted;
    const second = deps.resolveNewContact(contactInput, resolveArgs(8));
    const results = await Promise.allSettled([
      first,
      second,
    ]);

    const snapshot = createSnapshot.current;
    assert.ok(snapshot);
    assert.equal(snapshot.transactionActive, false);
    assert.ok(snapshot.customerClaim);
    assert.ok(snapshot.sessionMarkers.some(Boolean));
    assert.equal(ghl.creates, 1);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const blocked = results.find((result) => result.status === "rejected");
    assert.ok(blocked?.status === "rejected");
    assert.ok(blocked.reason instanceof CreationNeedsReconciliationError);
    assert.equal(fake.client.ghlContactId, "contact-created");
    assert.equal(fake.client.ghlContactCreationState, null);
    assert.ok(fake.sql.some((query) => query.includes("GolfClient") && query.includes("FOR UPDATE")));
  } finally {
    ghl.restore();
  }
});

test("ambiguous contact creation blocks other sessions and safely recovers the original session", async () => {
  const fake = fakeDatabase();
  const ghl = installFakeGhlApi({ loseCreateResponse: true });
  const createSnapshot: {
    current: {
      transactionActive: boolean;
      customerClaim: unknown;
      sessionMarker: unknown;
    } | null;
  } = { current: null };
  ghl.observeCreate(() => {
    createSnapshot.current = {
      transactionActive: fake.transactionActive,
      customerClaim: fake.client.ghlContactCreationState,
      sessionMarker: fake.sessions.get(7)?.ghlSyncState,
    };
  });
  try {
    const deps = createPrismaStagedSyncDeps(fake.db as never);
    await assert.rejects(
      deps.resolveNewContact(contactInput, resolveArgs(7)),
      CreationNeedsReconciliationError,
    );
    const snapshot = createSnapshot.current;
    assert.ok(snapshot);
    assert.equal(snapshot.transactionActive, false);
    assert.ok(snapshot.customerClaim);
    assert.ok(snapshot.sessionMarker);
    assert.equal(ghl.creates, 1);
    assert.ok(fake.client.ghlContactCreationState);
    assert.ok(fake.sessions.get(7)?.ghlSyncState);

    ghl.loseCreateResponse(false);
    await assert.rejects(
      deps.resolveNewContact(contactInput, resolveArgs(8)),
      CreationNeedsReconciliationError,
    );
    assert.equal(ghl.creates, 1);

    const recovered = await deps.resolveNewContact(contactInput, resolveArgs(7));
    assert.deepEqual(recovered, { id: "contact-created" });
    assert.equal(ghl.creates, 1);
    assert.equal(fake.client.ghlContactId, "contact-created");
    assert.equal(fake.client.ghlContactCreationState, null);
  } finally {
    ghl.restore();
  }
});
