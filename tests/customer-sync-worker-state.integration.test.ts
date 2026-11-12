import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, describe, test } from "node:test";
import { enqueueCustomerSync } from "../lib/ghl/customerSyncOutbox";
import { claimFittingSync, releaseFittingSync } from "../lib/ghl/fittingSyncClaim";
import {
  claimCustomerSync,
  completeCustomerSync,
  failCustomerSync,
  listCustomerSyncCandidates,
  type CustomerSyncClaim,
} from "../lib/ghl/customerSyncWorkerState";
import {
  assertCustomerSyncTestDatabaseIdentity,
  createCustomerSyncTestClient,
  getCustomerSyncTestDatabaseConfig,
} from "./helpers/customerSyncTestDatabase";

const skip = process.env.DATABASE_URL_TEST
  ? false
  : "Set DATABASE_URL_TEST to the guarded local test database to run integration tests.";

describe("customer sync worker state MySQL integration", { skip }, () => {
  let db: ReturnType<typeof createCustomerSyncTestClient>;
  let verified = false;
  const fixtureIds: number[] = [];

  before(async () => {
    const config = getCustomerSyncTestDatabaseConfig();
    db = createCustomerSyncTestClient(config);
    await assertCustomerSyncTestDatabaseIdentity(db, config);
    verified = true;
  });

  afterEach(async () => {
    if (!verified || fixtureIds.length === 0) return;
    await db.demoSession.deleteMany({ where: { clientId: { in: fixtureIds } } });
    await db.golfClient.deleteMany({ where: { id: { in: fixtureIds.splice(0) } } });
  });

  after(async () => {
    if (db) await db.$disconnect();
  });

  async function fixture(): Promise<number> {
    const customer = await db.golfClient.create({
      data: { firstName: "Worker", email: `worker-${randomUUID()}@example.test` },
      select: { id: true },
    });
    fixtureIds.push(customer.id);
    await db.$transaction((tx) =>
      enqueueCustomerSync(tx, { golfClientId: customer.id, reason: "created" }),
    );
    return customer.id;
  }

  async function requireClaim(id: number): Promise<CustomerSyncClaim> {
    const result = await claimCustomerSync(db, id, 60_000);
    assert.equal(result.status, "claimed");
    if (result.status !== "claimed") throw new Error("claim failed");
    assert.equal(typeof result.claim.version, "number");
    assert.ok(Number.isSafeInteger(result.claim.version));
    assert.ok(result.claim.version > 0);
    return result.claim;
  }

  test("competing claims yield one owner and separate customers can be claimed concurrently", async () => {
    const first = await fixture();
    const second = await fixture();
    const results = await Promise.all([
      claimCustomerSync(db, first, 60_000),
      claimCustomerSync(db, first, 60_000),
      claimCustomerSync(db, second, 60_000),
    ]);
    assert.equal(results.filter((result) => result.status === "claimed").length, 2);
    assert.equal(results.filter((result) => result.status === "unavailable").length, 1);
    assert.equal((await db.golfClientSyncState.findUniqueOrThrow({ where: { golfClientId: first } })).attemptCount, 1);
    assert.equal((await db.golfClientSyncState.findUniqueOrThrow({ where: { golfClientId: second } })).attemptCount, 1);
  });

  test("customer and fitting claims serialize in both directions and only the owner may nest", async () => {
    const id = await fixture();
    const session = await db.demoSession.create({ data: { clientId: id, lockerToken: randomUUID() } });
    const other = await db.demoSession.create({ data: { clientId: id, lockerToken: randomUUID() } });
    const fitting = await claimFittingSync(db, session.id);
    assert.ok(fitting);
    assert.deepEqual(await claimCustomerSync(db, id, 60_000), { status: "fitting_blocked" });
    assert.deepEqual(await claimCustomerSync(db, id, 60_000, { sessionId: session.id, token: randomUUID() }), { status: "fitting_blocked" });
    assert.deepEqual(await claimCustomerSync(db, id, 60_000, { sessionId: other.id, token: fitting }), { status: "fitting_blocked" });
    const nested = await claimCustomerSync(db, id, 60_000, { sessionId: session.id, token: fitting });
    assert.equal(nested.status, "claimed");
    if (nested.status !== "claimed") throw new Error("nested claim failed");
    await db.$transaction((tx) => enqueueCustomerSync(tx, { golfClientId: id, reason: "profile_changed" }));
    assert.deepEqual(await completeCustomerSync(db, nested.claim), { status: "applied" });
    assert.equal((await db.golfClientSyncState.findUniqueOrThrow({ where: { golfClientId: id } })).workStatus, "pending");
    assert.equal(await releaseFittingSync(db, session.id, fitting), true);

    const worker = await requireClaim(id);
    assert.equal(await claimFittingSync(db, session.id), null);
    assert.deepEqual(await failCustomerSync(db, worker, {
      kind: "retryable", retrySafety: "no_remote_write", delayMs: 1000, code: "read_failed", message: "Read failed",
    }), { status: "applied" });
    const next = await claimFittingSync(db, session.id);
    assert.ok(next);
    assert.equal(await releaseFittingSync(db, session.id, next), true);
  });

  test("concurrent customer and fitting acquisition has exactly one winner", async () => {
    for (let iteration = 0; iteration < 4; iteration++) {
      const id = await fixture();
      const session = await db.demoSession.create({ data: { clientId: id, lockerToken: randomUUID() } });
      const [fitting, customer] = await Promise.all([
        claimFittingSync(db, session.id),
        claimCustomerSync(db, id, 60_000),
      ]);
      assert.equal(Number(fitting !== null) + Number(customer.status === "claimed"), 1);
      if (fitting) {
        assert.equal(customer.status, "fitting_blocked");
        assert.equal(await releaseFittingSync(db, session.id, fitting), true);
      } else {
        assert.equal(customer.status, "claimed");
        if (customer.status !== "claimed") throw new Error("customer claim failed");
        assert.equal(await claimFittingSync(db, session.id), null);
        assert.deepEqual(await completeCustomerSync(db, customer.claim), { status: "applied" });
        const next = await claimFittingSync(db, session.id);
        assert.ok(next);
        assert.equal(await releaseFittingSync(db, session.id, next), true);
      }
    }
  });

  test("a locked customer does not prevent claiming a different customer", async () => {
    const first = await fixture();
    const second = await fixture();
    let release!: () => void;
    let locked!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { locked = resolve; });
    const holding = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM GolfClient WHERE id = ${first} FOR UPDATE`;
      locked();
      await gate;
    }, { timeout: 15_000 });
    await ready;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        claimCustomerSync(db, second, 60_000),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("independent customer claim blocked")), 5000);
        }),
      ]);
      assert.equal(result.status, "claimed");
    } finally {
      if (timer) clearTimeout(timer);
      release();
      await holding;
    }
  });

  test("enqueue during processing retains the claim and completion advances only the claimed version", async () => {
    const id = await fixture();
    const claim = await requireClaim(id);
    await db.$transaction((tx) =>
      enqueueCustomerSync(tx, { golfClientId: id, reason: "profile_changed" }),
    );
    const before = await db.golfClientSyncState.findUniqueOrThrow({ where: { golfClientId: id } });
    assert.equal(before.desiredVersion, 2);
    assert.equal(before.claimToken, claim.token);
    assert.equal(before.claimedVersion, 1);
    assert.deepEqual(await completeCustomerSync(db, claim), { status: "applied" });
    const after = await db.golfClientSyncState.findUniqueOrThrow({ where: { golfClientId: id } });
    assert.equal(after.syncedVersion, 1);
    assert.equal(after.workStatus, "pending");
  });

  test("stale and expired claims cannot transition, and expiry requires reconciliation", async () => {
    const id = await fixture();
    const claim = await requireClaim(id);
    assert.deepEqual(await completeCustomerSync(db, { ...claim, token: randomUUID() }), { status: "lost_claim" });
    await db.$executeRaw`
      UPDATE GolfClientSyncState SET leaseExpiresAt = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 SECOND)
      WHERE golfClientId = ${id}
    `;
    assert.deepEqual(await failCustomerSync(db, claim, {
      kind: "retryable", retrySafety: "no_remote_write", delayMs: 1000, code: "test", message: "test",
    }), { status: "lost_claim" });
    assert.ok((await listCustomerSyncCandidates(db, 1000)).includes(id));
    assert.deepEqual(await claimCustomerSync(db, id, 60_000), { status: "needs_reconciliation" });
    const state = await db.golfClientSyncState.findUniqueOrThrow({ where: { golfClientId: id } });
    assert.equal(state.workStatus, "needs_reconciliation");
    assert.equal(state.claimToken, null);
    assert.equal(state.syncedVersion, 0);
  });

  test("retry is not eligible until database time is due; review and reconciliation remain blocked", async () => {
    const ids = await Promise.all([fixture(), fixture(), fixture()]);
    const [retry, review, reconcile] = await Promise.all(ids.map(requireClaim));
    assert.ok(retry && review && reconcile);
    await failCustomerSync(db, retry, {
      kind: "retryable", retrySafety: "definitively_rejected", delayMs: 60_000, code: "unavailable", message: "Unavailable",
    });
    await failCustomerSync(db, review, { kind: "review", code: "identity", message: "Review" });
    await failCustomerSync(db, reconcile, { kind: "reconciliation", code: "unknown", message: "Reconcile" });
    assert.deepEqual(await claimCustomerSync(db, retry.golfClientId, 60_000), { status: "unavailable" });
    await db.$executeRaw`
      UPDATE GolfClientSyncState SET nextAttemptAt = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 SECOND)
      WHERE golfClientId = ${retry.golfClientId}
    `;
    assert.equal((await claimCustomerSync(db, retry.golfClientId, 60_000)).status, "claimed");
    for (const claim of [review, reconcile]) {
      await db.$transaction((tx) =>
        enqueueCustomerSync(tx, { golfClientId: claim.golfClientId, reason: "profile_changed" }),
      );
      assert.equal((await claimCustomerSync(db, claim.golfClientId, 60_000)).status, "unavailable");
    }
    assert.equal((await db.golfClientSyncState.findUniqueOrThrow({ where: { golfClientId: review.golfClientId } })).workStatus, "needs_review");
    assert.equal((await db.golfClientSyncState.findUniqueOrThrow({ where: { golfClientId: reconcile.golfClientId } })).workStatus, "needs_reconciliation");
  });

  test("rollback preserves the processing claim and concurrent enqueue/claim operations do not deadlock", async () => {
    const id = await fixture();
    const claim = await requireClaim(id);
    await assert.rejects(db.$transaction(async (tx) => {
      await enqueueCustomerSync(tx, { golfClientId: id, reason: "profile_changed" });
      throw new Error("rollback test");
    }), /rollback test/);
    const unchanged = await db.golfClientSyncState.findUniqueOrThrow({ where: { golfClientId: id } });
    assert.equal(unchanged.desiredVersion, 1);
    assert.equal(unchanged.claimToken, claim.token);

    await Promise.all([
      ...Array.from({ length: 4 }, () =>
        db.$transaction((tx) =>
          enqueueCustomerSync(tx, { golfClientId: id, reason: "profile_changed" }),
        ),
      ),
      ...Array.from({ length: 4 }, () => claimCustomerSync(db, id, 60_000)),
    ]);
    const state = await db.golfClientSyncState.findUniqueOrThrow({ where: { golfClientId: id } });
    assert.equal(state.desiredVersion, 5);
    assert.equal(state.claimToken, claim.token);
    assert.equal(state.workStatus, "processing");
  });

  test("unresolved creation attempts survive and block claims", async () => {
    const id = await fixture();
    await db.golfClientSyncState.update({
      where: { golfClientId: id },
      data: { creationAttemptId: randomUUID(), creationAttemptStatus: "started", creationAttemptVersion: 1, creationAttemptedAt: new Date() },
    });
    assert.deepEqual(await claimCustomerSync(db, id, 60_000), { status: "needs_reconciliation" });
    const state = await db.golfClientSyncState.findUniqueOrThrow({ where: { golfClientId: id } });
    assert.equal(state.creationAttemptStatus, "started");
    assert.ok(state.creationAttemptId);
  });
});
