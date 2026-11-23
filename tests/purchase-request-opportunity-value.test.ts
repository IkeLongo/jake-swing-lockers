import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { GhlApiError } from "../lib/ghl/client";

const originalPrisma = Object.getOwnPropertyDescriptor(globalThis, "prisma");
Object.defineProperty(globalThis, "prisma", { configurable: true, writable: true, value: {} });
after(() => {
  if (originalPrisma) Object.defineProperty(globalThis, "prisma", originalPrisma);
  else Reflect.deleteProperty(globalThis, "prisma");
});

let syncModule: typeof import("../lib/ghl/purchaseRequestOpportunityValue");
before(async () => {
  syncModule = await import("../lib/ghl/purchaseRequestOpportunityValue");
});

function harness() {
  const sessions = [
    { id: 1, ghlOpportunityId: "opp-A" },
    { id: 2, ghlOpportunityId: "opp-A" },
    { id: 3, ghlOpportunityId: "opp-B" },
  ];
  const requests: { sessionId: number; status: string; prices: (number | null)[] }[] = [];
  const events: { id: number; status: string; message: string; eventType: string }[] = [];
  const writes: number[] = [];
  let tail = Promise.resolve();
  const fake = {
    async $transaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try { return await fn(fake as never); } finally { release(); }
    },
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join("?");
      if (sql.includes("FROM DemoSession")) {
        return sessions.filter((session) => session.ghlOpportunityId === values[0]).map(({ id }) => ({ id }));
      }
      if (sql.includes("FROM GhlSyncEvent")) {
        return events.filter((event) => event.eventType === values[0] &&
          JSON.parse(event.message).opportunityId === values[1] &&
          ["queued", "pending"].includes(event.status));
      }
      if (sql.includes("FROM PurchaseRequest r")) {
        assert.match(sql, /BINARY s\.ghlOpportunityId = BINARY/);
        const statusList = sql.match(/r\.status IN \(([^)]+)\)/)?.[1];
        assert.ok(statusList);
        const eligible = [...statusList.matchAll(/'([^']+)'/g)].map((match) => match[1]);
        const matching = requests.filter((request) =>
          sessions.some((session) => session.id === request.sessionId && session.ghlOpportunityId === values[0]) &&
          eligible.includes(request.status));
        const cents = matching.flatMap((request) => request.prices)
          .reduce<number>((sum, price) => sum + Math.round((price ?? 0) * 100), 0);
        return [{ requestCount: BigInt(matching.length), total: (cents / 100).toFixed(2) }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    demoSession: {
      async findUniqueOrThrow({ where }: { where: { id: number } }) {
        const session = sessions.find((item) => item.id === where.id);
        if (!session) throw new Error("Missing session");
        return session;
      },
    },
    ghlSyncEvent: {
      async create({ data }: { data: { eventType: string; status: string; message: string } }) {
        const event = { id: events.length + 1, ...data };
        events.push(event);
        return event;
      },
      async update({ where, data }: { where: { id: number }; data: { status: string } }) {
        const event = events.find((item) => item.id === where.id);
        assert.ok(event);
        event.status = data.status;
        return event;
      },
      async updateMany({ where, data }: { where: { id: number; status: string; eventType: string }; data: { status?: string; message?: string } }) {
        const event = events.find((item) => item.id === where.id &&
          item.status === where.status && item.eventType === where.eventType);
        if (!event) return { count: 0 };
        if (data.status !== undefined) event.status = data.status;
        if (data.message !== undefined) event.message = data.message;
        return { count: 1 };
      },
    },
  };
  const deps = syncModule.createOpportunityValueSyncDeps(fake as never);
  deps.update = async (_id, value) => { writes.push(value); };
  const enqueue = (sessionId: number) =>
    syncModule.enqueuePurchaseRequestOpportunityValue(fake as never, sessionId);
  return { requests, events, writes, deps, enqueue };
}

test("value includes qualifying snapshots from all linked sessions and treats missing prices as zero", async () => {
  const h = harness();
  h.requests.push(
    { sessionId: 1, status: "new_request", prices: [100.25, null] },
    { sessionId: 2, status: "reviewing", prices: [200] },
    { sessionId: 2, status: "quote_sent", prices: [10] },
    { sessionId: 2, status: "purchased", prices: [20] },
    { sessionId: 2, status: "fulfilled", prices: [30] },
    { sessionId: 1, status: "closed_lost", prices: [500] },
    { sessionId: 2, status: "cancelled", prices: [500] },
    { sessionId: 3, status: "new_request", prices: [500] },
  );
  await h.enqueue(1);
  assert.equal(await syncModule.drainPurchaseRequestOpportunityValue("opp-A", h.deps), "synced");
  assert.deepEqual(h.writes, [360.25]);
  assert.deepEqual(h.requests[0].prices, [100.25, null]);
});

test("no qualifying requests preserve the value, while all-null qualifying prices write zero", async () => {
  const h = harness();
  h.requests.push({ sessionId: 1, status: "closed_lost", prices: [100] });
  await h.enqueue(1);
  await syncModule.drainPurchaseRequestOpportunityValue("opp-A", h.deps);
  assert.deepEqual(h.writes, []);
  h.requests.push({ sessionId: 2, status: "new_request", prices: [null] });
  await h.enqueue(2);
  await syncModule.drainPurchaseRequestOpportunityValue("opp-A", h.deps);
  assert.deepEqual(h.writes, [0]);
});

test("item edits and status changes recalculate the combined value", async () => {
  const h = harness();
  h.requests.push(
    { sessionId: 1, status: "new_request", prices: [100] },
    { sessionId: 2, status: "cancelled", prices: [30] },
  );
  await h.enqueue(1);
  await syncModule.drainPurchaseRequestOpportunityValue("opp-A", h.deps);
  h.requests[0].prices = [125, null];
  h.requests[1].status = "fulfilled";
  await h.enqueue(2);
  await syncModule.drainPurchaseRequestOpportunityValue("opp-A", h.deps);
  h.requests[0].status = "closed_lost";
  await h.enqueue(1);
  await syncModule.drainPurchaseRequestOpportunityValue("opp-A", h.deps);
  assert.deepEqual(h.writes, [100, 155, 30]);
});

test("an edit queued during an in-flight write is recalculated afterward", async () => {
  const h = harness();
  h.requests.push({ sessionId: 1, status: "new_request", prices: [100] });
  let release!: () => void;
  let started!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const began = new Promise<void>((resolve) => { started = resolve; });
  h.deps.update = async (_id, value) => {
    h.writes.push(value);
    if (h.writes.length === 1) { started(); await blocked; }
  };
  await h.enqueue(1);
  const first = syncModule.drainPurchaseRequestOpportunityValue("opp-A", h.deps);
  await began;
  h.requests.push({ sessionId: 2, status: "reviewing", prices: [50] });
  await h.enqueue(2);
  assert.equal(await syncModule.drainPurchaseRequestOpportunityValue("opp-A", h.deps), "queued");
  release();
  assert.equal(await first, "synced");
  assert.deepEqual(h.writes, [100, 150]);
  assert.deepEqual(h.events.map((event) => event.status), ["success", "success"]);
});

test("uncertain writes remain pending and block subsequent writes across restarts", async () => {
  const h = harness();
  h.requests.push({ sessionId: 1, status: "new_request", prices: [100] });
  h.deps.update = async () => { throw new Error("timed out"); };
  await h.enqueue(1);
  await assert.rejects(syncModule.drainPurchaseRequestOpportunityValue("opp-A", h.deps), /timed out/);
  await h.enqueue(2);
  assert.equal(await syncModule.drainPurchaseRequestOpportunityValue("opp-A", h.deps), "queued");
  assert.deepEqual(h.events.map((event) => event.status), ["pending", "queued"]);
  assert.deepEqual(JSON.parse(h.events[0].message), { opportunityId: "opp-A", value: 100 });
});

test("failure to acknowledge a successful write leaves the attempt blocked", async () => {
  const h = harness();
  h.requests.push({ sessionId: 1, status: "new_request", prices: [100] });
  h.deps.finish = async () => { throw new Error("database unavailable"); };
  await h.enqueue(1);
  await assert.rejects(syncModule.drainPurchaseRequestOpportunityValue("opp-A", h.deps), /database unavailable/);
  await h.enqueue(2);
  assert.equal(await syncModule.drainPurchaseRequestOpportunityValue("opp-A", h.deps), "queued");
  assert.deepEqual(h.writes, [100]);
  assert.deepEqual(h.events.map((event) => event.status), ["pending", "queued"]);
});

test("definitive rejection releases the claim for a later recalculation", async () => {
  const h = harness();
  h.requests.push({ sessionId: 1, status: "new_request", prices: [100] });
  h.deps.update = async () => { throw new GhlApiError(422, "Invalid", "rejected"); };
  await h.enqueue(1);
  await assert.rejects(syncModule.drainPurchaseRequestOpportunityValue("opp-A", h.deps), /422/);
  assert.equal(h.events[0].status, "failed");
  h.deps.update = async (_id, value) => { h.writes.push(value); };
  h.requests[0].prices = [125];
  await h.enqueue(1);
  await syncModule.drainPurchaseRequestOpportunityValue("opp-A", h.deps);
  assert.deepEqual(h.writes, [125]);
});
