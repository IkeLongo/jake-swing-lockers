import assert from "node:assert/strict";
import { test } from "node:test";
import {
  claimCustomerSync,
  completeCustomerSync,
  failCustomerSync,
  listCustomerSyncCandidates,
  type CustomerSyncClaim,
} from "../lib/ghl/customerSyncWorkerState";
import { claimFittingSync, claimFittingSyncResult, releaseFittingSync } from "../lib/ghl/fittingSyncClaim";
import { Prisma } from "../app/generated/prisma/client";
import { runCustomerContactSyncBatch } from "../lib/ghl/runCustomerContactSyncBatch";

interface Row {
  golfClientId: number;
  workStatus: string;
  desiredVersion: number;
  syncedVersion: number;
  claimedVersion: number | null;
  claimToken: string | null;
  leaseExpiresAt: number | null;
  nextAttemptAt: number | null;
  lastAttemptAt: number | null;
  attemptCount: number;
  creationAttemptId: string | null;
  creationAttemptVersion: number | null;
  creationAttemptStatus: string | null;
  creationAttemptedAt: number | null;
  lastErrorCode: string | null;
  lastError: string | null;
  legacyClaim: unknown;
}

function row(id: number, patch: Partial<Row> = {}): Row {
  return {
    golfClientId: id,
    workStatus: "pending",
    desiredVersion: 1,
    syncedVersion: 0,
    claimedVersion: null,
    claimToken: null,
    leaseExpiresAt: null,
    nextAttemptAt: null,
    lastAttemptAt: null,
    attemptCount: 0,
    creationAttemptId: null,
    creationAttemptVersion: null,
    creationAttemptStatus: null,
    creationAttemptedAt: null,
    lastErrorCode: null,
    lastError: null,
    legacyClaim: null,
    ...patch,
  };
}

function harness(initial: Row[], options: { unsignedAsBigInt?: boolean } = {}) {
  const rows = new Map(initial.map((value) => [value.golfClientId, { ...value }]));
  const sessions = new Map<number, { id: number; clientId: number; ghlSyncState: unknown }>();
  const tails = new Map<number, Promise<void>>();
  const sql: string[] = [];
  const transactionSql: string[][] = [];
  let now = 1_000_000;
  let failWrite = false;
  let expireAtNextWrite = false;

  const db = {
    async $queryRaw(strings: TemplateStringsArray, limit: number) {
      sql.push(strings.join("?"));
      return [...rows.values()]
        .filter((r) =>
          r.workStatus === "pending" ||
          (r.workStatus === "retryable_failed" && r.nextAttemptAt !== null && r.nextAttemptAt <= now) ||
          (r.workStatus === "processing" && (r.leaseExpiresAt === null || r.leaseExpiresAt <= now)),
        )
        .sort((a, b) =>
          (a.lastAttemptAt ?? 0) - (b.lastAttemptAt ?? 0) ||
          a.golfClientId - b.golfClientId,
        )
        .slice(0, limit)
        .map((r) => ({ golfClientId: r.golfClientId }));
    },
    async $transaction<T>(callback: (tx: never) => Promise<T>): Promise<T> {
      let local: Row | null = null;
      let lockedId: number | null = null;
      let release = () => {};
      const statements: string[] = [];
      transactionSql.push(statements);
      const tx = {
        async $queryRaw(strings: TemplateStringsArray, id: number) {
          const query = strings.join("?");
          sql.push(query);
          statements.push(query);
          if (query.includes("FROM GolfClient WHERE")) {
            const previous = tails.get(id) ?? Promise.resolve();
            let unlock!: () => void;
            const next = new Promise<void>((resolve) => { unlock = resolve; });
            tails.set(id, next);
            await previous;
            release = unlock;
            lockedId = id;
            local = rows.has(id) ? { ...rows.get(id)! } : null;
            return local ? [{ id }] : [];
          }
          if (query.includes("FROM DemoSession WHERE id")) {
            return sessions.has(id) ? [{ id }] : [];
          }
          assert.equal(lockedId, id);
          if (query.includes("FROM DemoSession")) {
            return [...sessions.values()]
              .filter((session) => session.clientId === id)
              .sort((a, b) => a.id - b.id)
              .map((session) => structuredClone(session));
          }
          return local ? [{
            ...local,
            ...(options.unsignedAsBigInt ? {
              desiredVersion: BigInt(local.desiredVersion),
              syncedVersion: BigInt(local.syncedVersion),
              claimedVersion: local.claimedVersion === null ? null : BigInt(local.claimedVersion),
              creationAttemptVersion: local.creationAttemptVersion === null ? null : BigInt(local.creationAttemptVersion),
            } : {}),
            retryDue: local.nextAttemptAt === null ? null : Number(local.nextAttemptAt <= now),
            leaseValid: local.leaseExpiresAt === null ? null : Number(local.leaseExpiresAt > now),
          }] : [];
        },
        golfClient: {
          async findUniqueOrThrow() {
            assert.ok(local);
            return { ghlContactCreationState: local.legacyClaim };
          },
        },
        demoSession: {
          async findUnique({ where }: { where: { id: number } }) {
            const session = sessions.get(where.id);
            return session ? { clientId: session.clientId } : null;
          },
          async findUniqueOrThrow({ where }: { where: { id: number } }) {
            const session = sessions.get(where.id);
            assert.ok(session);
            return { ghlSyncState: structuredClone(session.ghlSyncState) };
          },
          async update({ where, data }: { where: { id: number }; data: { ghlSyncState: unknown } }) {
            const session = sessions.get(where.id);
            assert.ok(session);
            session.ghlSyncState = data.ghlSyncState === Prisma.DbNull ? null : structuredClone(data.ghlSyncState);
          },
        },
        golfClientSyncState: {
          async update(args: { data: Partial<Row> }) {
            assert.ok(local);
            Object.assign(local, args.data);
          },
        },
        async $executeRaw(strings: TemplateStringsArray, ...values: (string | number)[]) {
          const query = strings.join("?");
          sql.push(query);
          assert.ok(local);
          if (query.includes("SET lastAttemptAt = CURRENT_TIMESTAMP")) {
            local.lastAttemptAt = now;
            return 1;
          }
          if (failWrite) {
            local.workStatus = "processing";
            local.attemptCount++;
            throw new Error("simulated write failure");
          }
          if (expireAtNextWrite) {
            expireAtNextWrite = false;
            now = local.leaseExpiresAt ?? now;
          }
          if (query.includes("attemptCount = attemptCount + 1")) {
            local.workStatus = "processing";
            local.claimToken = String(values[0]);
            local.claimedVersion = local.desiredVersion;
            local.leaseExpiresAt = now + Number(values[1]) / 1000;
            local.lastAttemptAt = now;
            local.nextAttemptAt = null;
            local.attemptCount++;
            return 1;
          }
          const [id, token, version] = values.slice(-3);
          if (
            id !== local.golfClientId ||
            local.workStatus !== "processing" ||
            local.claimToken !== token ||
            local.claimedVersion !== version ||
            local.leaseExpiresAt === null ||
            local.leaseExpiresAt <= now
          ) return 0;
          if (query.includes("syncedVersion =")) {
            local.syncedVersion = Number(values[0]);
            local.workStatus = local.desiredVersion > local.syncedVersion ? "pending" : "synced";
            local.lastErrorCode = null;
            local.lastError = null;
            local.nextAttemptAt = null;
          } else if (query.includes("workStatus = 'retryable_failed'")) {
            local.workStatus = "retryable_failed";
            local.nextAttemptAt = now + Number(values[0]) / 1000;
            local.lastErrorCode = String(values[1]);
            local.lastError = String(values[2]);
          } else if (query.includes("workStatus = 'needs_reconciliation'")) {
            local.workStatus = "needs_reconciliation";
            local.lastErrorCode = "inconsistent_sync_state";
          } else {
            local.workStatus = String(values[0]);
            local.lastErrorCode = String(values[1]);
            local.lastError = String(values[2]);
          }
          local.claimToken = null;
          local.claimedVersion = null;
          local.leaseExpiresAt = null;
          return 1;
        },
      };
      try {
        const result = await callback(tx as never);
        if (local && lockedId !== null) rows.set(lockedId, local);
        return result;
      } finally {
        release();
      }
    },
  };
  return {
    db: db as never,
    rows,
    sessions,
    sql,
    transactionSql,
    advance(ms: number) { now += ms; },
    failWrites(value: boolean) { failWrite = value; },
    expireOnWrite() { expireAtNextWrite = true; },
  };
}

async function claimed(h: ReturnType<typeof harness>, id: number, leaseMs = 1000): Promise<CustomerSyncClaim> {
  const result = await claimCustomerSync(h.db, id, leaseMs);
  assert.equal(result.status, "claimed");
  if (result.status !== "claimed") throw new Error("claim failed");
  return result.claim;
}

test("two workers cannot claim one customer; different customers can be claimed", async () => {
  const h = harness([row(1), row(2)]);
  const results = await Promise.all([
    claimCustomerSync(h.db, 1, 1000),
    claimCustomerSync(h.db, 1, 1000),
    claimCustomerSync(h.db, 2, 1000),
  ]);
  assert.equal(results.filter((r) => r.status === "claimed").length, 2);
  assert.equal(h.rows.get(1)?.attemptCount, 1);
  assert.equal(h.rows.get(2)?.attemptCount, 1);
  for (const transaction of h.transactionSql) {
    const locks = transaction.filter((query) => query.includes("FOR UPDATE"));
    assert.equal(locks.length, 3);
    assert.match(locks[0]!, /FROM GolfClient WHERE/);
    assert.match(locks[1]!, /FROM GolfClientSyncState WHERE/);
    assert.match(locks[2]!, /FROM DemoSession/);
  }
});

test("fitting claims block customer workers except the verified owning fitting", async () => {
  const h = harness([row(1)]);
  h.sessions.set(10, { id: 10, clientId: 1, ghlSyncState: null });
  h.sessions.set(11, { id: 11, clientId: 1, ghlSyncState: null });
  const token = await claimFittingSync(h.db, 10);
  assert.ok(token);
  assert.deepEqual(await claimCustomerSync(h.db, 1, 1000), { status: "fitting_blocked" });
  assert.deepEqual(await claimCustomerSync(h.db, 1, 1000, { sessionId: 10, token: "wrong" }), { status: "fitting_blocked" });
  assert.deepEqual(await claimCustomerSync(h.db, 1, 1000, { sessionId: 11, token }), { status: "fitting_blocked" });
  const nested = await claimCustomerSync(h.db, 1, 1000, { sessionId: 10, token });
  assert.equal(nested.status, "claimed");
  if (nested.status !== "claimed") throw new Error("nested claim failed");
  assert.deepEqual(await completeCustomerSync(h.db, nested.claim), { status: "applied" });
  assert.deepEqual(await claimCustomerSync(h.db, 1, 1000), { status: "fitting_blocked" });
  assert.equal(await releaseFittingSync(h.db, 10, token), true);
  assert.deepEqual(await claimCustomerSync(h.db, 1, 1000, { sessionId: 10, token }), { status: "fitting_blocked" });
});

test("fitting distinguishes a live customer worker from an interrupted one", async () => {
  const h = harness([row(1)]);
  h.sessions.set(10, { id: 10, clientId: 1, ghlSyncState: null });
  await claimed(h, 1);
  assert.deepEqual(await claimFittingSyncResult(h.db, 10), { status: "customer_busy" });
  h.advance(1000);
  assert.deepEqual(await claimFittingSyncResult(h.db, 10), { status: "blocked" });
  assert.equal(h.sessions.get(10)!.ghlSyncState, null);
});

test("fitting-blocked candidates rotate behind unattempted customers", async () => {
  const h = harness([row(1), row(2), row(3)]);
  h.sessions.set(10, { id: 10, clientId: 1, ghlSyncState: { version: 1, fittingClaim: { token: "interrupted" } } });
  assert.deepEqual(await listCustomerSyncCandidates(h.db, 1), [1]);
  assert.equal((await claimCustomerSync(h.db, 1, 1000)).status, "fitting_blocked");
  assert.deepEqual(await listCustomerSyncCandidates(h.db, 1), [2]);
  assert.equal((await claimCustomerSync(h.db, 2, 1000)).status, "claimed");
  assert.deepEqual(await listCustomerSyncCandidates(h.db, 1), [3]);
  assert.equal(h.rows.get(1)?.workStatus, "pending");
});

test("successive recovery batches reach customers behind an interrupted fitting", async () => {
  const flag = process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED;
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  try {
    const h = harness([row(1), row(2), row(3)]);
    h.sessions.set(10, { id: 10, clientId: 1, ghlSyncState: { version: 1, fittingClaim: { token: "interrupted" } } });
    const attempted: number[] = [];
    const deps = {
      listCandidates: (limit: number) => listCustomerSyncCandidates(h.db, limit),
      async processCustomer(id: number) {
        attempted.push(id);
        const result = await claimCustomerSync(h.db, id, 1000);
        if (result.status !== "claimed") return { status: "unavailable" as const };
        await completeCustomerSync(h.db, result.claim);
        return { status: "synced" as const, contactId: "contact" };
      },
    };
    for (let i = 0; i < 3; i++) {
      await runCustomerContactSyncBatch(1, deps);
      h.advance(1000);
    }
    assert.deepEqual(attempted, [1, 2, 3]);
    assert.equal(h.rows.get(1)?.workStatus, "pending");
  } finally {
    if (flag === undefined) delete process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED;
    else process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = flag;
  }
});

test("interrupted or unresolved sibling fitting states remain blocking", async () => {
  const h = harness([row(1)]);
  h.sessions.set(10, { id: 10, clientId: 1, ghlSyncState: JSON.stringify({ version: 1, fittingClaim: { token: "interrupted" } }) });
  assert.deepEqual(await claimCustomerSync(h.db, 1, 1000), { status: "fitting_blocked" });
  assert.equal(h.rows.get(1)?.workStatus, "pending");
  h.sessions.get(10)!.ghlSyncState = null;
  const token = await claimFittingSync(h.db, 10);
  assert.ok(token);
  h.sessions.set(11, { id: 11, clientId: 1, ghlSyncState: { version: 1, opportunity: { status: "creating" } } });
  assert.deepEqual(await claimCustomerSync(h.db, 1, 1000, { sessionId: 10, token }), { status: "fitting_blocked" });
  h.sessions.delete(11);
  assert.equal(await releaseFittingSync(h.db, 10, token), true);
  assert.equal((await claimCustomerSync(h.db, 1, 1000)).status, "claimed");
});

test("customer claims block fittings until safely released; expired claims require reconciliation", async () => {
  const h = harness([row(1)]);
  h.sessions.set(10, { id: 10, clientId: 1, ghlSyncState: null });
  const claim = await claimed(h, 1);
  assert.equal(await claimFittingSync(h.db, 10), null);
  assert.deepEqual(await failCustomerSync(h.db, claim, {
    kind: "retryable", retrySafety: "no_remote_write", delayMs: 1000, code: "read_failed", message: "Read failed",
  }), { status: "applied" });
  const token = await claimFittingSync(h.db, 10);
  assert.ok(token);
  assert.equal(await releaseFittingSync(h.db, 10, token), true);
  h.advance(1000);
  const next = await claimed(h, 1);
  h.advance(1000);
  assert.equal(await claimFittingSync(h.db, 10), null);
  assert.deepEqual(await claimCustomerSync(h.db, 1, 1000), { status: "needs_reconciliation" });
  assert.equal(await claimFittingSync(h.db, 10), null);
  assert.deepEqual(await completeCustomerSync(h.db, next), { status: "lost_claim" });
});

test("concurrent fitting and customer claims have only one winner", async () => {
  for (const fittingFirst of [true, false]) {
    const h = harness([row(1)]);
    h.sessions.set(10, { id: 10, clientId: 1, ghlSyncState: null });
    const fitting = () => claimFittingSync(h.db, 10);
    const customer = () => claimCustomerSync(h.db, 1, 1000);
    const [fit, worker] = fittingFirst
      ? await Promise.all([fitting(), customer()])
      : await Promise.all([customer(), fitting()]).then(([worker, fit]) => [fit, worker] as const);
    assert.equal(Number(fit !== null) + Number(worker.status === "claimed"), 1);
    if (fit) {
      assert.equal(worker.status, "fitting_blocked");
      assert.equal(await releaseFittingSync(h.db, 10, fit), true);
      assert.equal((await claimCustomerSync(h.db, 1, 1000)).status, "claimed");
    } else {
      assert.equal(worker.status, "claimed");
      if (worker.status !== "claimed") throw new Error("worker claim failed");
      assert.deepEqual(await completeCustomerSync(h.db, worker.claim), { status: "applied" });
      assert.ok(await claimFittingSync(h.db, 10));
    }
  }
});

test("completion fences token and version and preserves edits queued during processing", async () => {
  const h = harness([row(1, { desiredVersion: 3, syncedVersion: 2 })]);
  const claim = await claimed(h, 1);
  assert.deepEqual(await completeCustomerSync(h.db, { ...claim, token: "stale" }), { status: "lost_claim" });
  assert.deepEqual(await completeCustomerSync(h.db, { ...claim, version: 2 }), { status: "lost_claim" });
  h.rows.get(1)!.desiredVersion = 4;
  assert.deepEqual(await completeCustomerSync(h.db, claim), { status: "applied" });
  assert.equal(h.rows.get(1)?.syncedVersion, 3);
  assert.equal(h.rows.get(1)?.workStatus, "pending");
  assert.deepEqual(await completeCustomerSync(h.db, claim), { status: "lost_claim" });
  const next = await claimed(h, 1);
  assert.deepEqual(await completeCustomerSync(h.db, next), { status: "applied" });
  assert.equal(h.rows.get(1)?.syncedVersion, 4);
  assert.equal(h.rows.get(1)?.workStatus, "synced");
});

test("unsigned bigint raw versions yield numeric claims and preserve fencing", async () => {
  const h = harness([row(1, { desiredVersion: 3, syncedVersion: 2 })], { unsignedAsBigInt: true });
  const claim = await claimed(h, 1);
  assert.equal(claim.version, 3);
  assert.equal(typeof claim.version, "number");
  assert.deepEqual(await completeCustomerSync(h.db, { ...claim, token: "stale" }), { status: "lost_claim" });
  h.rows.get(1)!.desiredVersion = 4;
  assert.deepEqual(await completeCustomerSync(h.db, claim), { status: "applied" });
  assert.equal(h.rows.get(1)?.syncedVersion, 3);
  assert.equal(h.rows.get(1)?.workStatus, "pending");
  const next = await claimed(h, 1);
  assert.deepEqual(await failCustomerSync(h.db, next, {
    kind: "retryable", retrySafety: "no_remote_write", delayMs: 2000, code: "unavailable", message: "Unavailable",
  }), { status: "applied" });
  assert.equal(h.rows.get(1)?.workStatus, "retryable_failed");
});

test("invalid raw versions fail before claiming without changing the state", async () => {
  for (const version of [-1, 0x1_0000_0000, Number.MAX_SAFE_INTEGER + 1]) {
    const h = harness([row(1, { desiredVersion: version })], { unsignedAsBigInt: true });
    await assert.rejects(claimCustomerSync(h.db, 1, 1000), /Invalid desiredVersion/);
    assert.equal(h.rows.get(1)?.workStatus, "pending");
    assert.equal(h.rows.get(1)?.attemptCount, 0);
  }
});

test("bigint raw versions do not weaken expired lease and creation-attempt protections", async () => {
  const h = harness([row(1), row(2)], { unsignedAsBigInt: true });
  const expired = await claimed(h, 1);
  h.advance(1000);
  assert.deepEqual(await failCustomerSync(h.db, expired, {
    kind: "retryable", retrySafety: "no_remote_write", delayMs: 2000, code: "unavailable", message: "Unavailable",
  }), { status: "lost_claim" });
  assert.deepEqual(await claimCustomerSync(h.db, 1, 1000), { status: "needs_reconciliation" });
  h.rows.get(2)!.creationAttemptVersion = 1;
  assert.deepEqual(await claimCustomerSync(h.db, 2, 1000), { status: "needs_reconciliation" });
});

test("expired leases are fenced and require reconciliation rather than retry", async () => {
  const h = harness([row(1)]);
  const claim = await claimed(h, 1);
  h.advance(1000);
  assert.deepEqual(await completeCustomerSync(h.db, claim), { status: "lost_claim" });
  assert.deepEqual(await claimCustomerSync(h.db, 1, 1000), { status: "needs_reconciliation" });
  assert.equal(h.rows.get(1)?.workStatus, "needs_reconciliation");
  assert.deepEqual(await claimCustomerSync(h.db, 1, 1000), { status: "unavailable" });
});

test("the SQL update fences a lease that expires after the locked read", async () => {
  const h = harness([row(1)]);
  const claim = await claimed(h, 1);
  h.expireOnWrite();
  assert.deepEqual(await completeCustomerSync(h.db, claim), { status: "lost_claim" });
  assert.equal(h.rows.get(1)?.syncedVersion, 0);
  assert.equal(h.rows.get(1)?.workStatus, "processing");
  assert.equal((await claimCustomerSync(h.db, 1, 1000)).status, "needs_reconciliation");
});

test("retry scheduling uses due time and preserves review and reconciliation states", async () => {
  const h = harness([row(1), row(2), row(3)]);
  const [a, b, c] = await Promise.all([claimed(h, 1), claimed(h, 2), claimed(h, 3)]);
  assert.deepEqual(await failCustomerSync(h.db, a, {
    kind: "retryable", retrySafety: "no_remote_write", delayMs: 2000, code: "unavailable", message: "Unavailable",
  }), { status: "applied" });
  await failCustomerSync(h.db, b, { kind: "review", code: "conflict", message: "Review" });
  await failCustomerSync(h.db, c, { kind: "reconciliation", code: "unknown", message: "Reconcile" });
  assert.deepEqual(
    await failCustomerSync(h.db, b, { kind: "review", code: "stale", message: "Stale" }),
    { status: "lost_claim" },
  );
  assert.equal(h.rows.get(2)?.lastErrorCode, "conflict");
  assert.deepEqual(await listCustomerSyncCandidates(h.db, 10), []);
  h.advance(2000);
  assert.deepEqual(await listCustomerSyncCandidates(h.db, 10), [1]);
  assert.equal((await claimCustomerSync(h.db, 1, 1000)).status, "claimed");
  assert.equal((await claimCustomerSync(h.db, 2, 1000)).status, "unavailable");
  assert.equal((await claimCustomerSync(h.db, 3, 1000)).status, "unavailable");
});

test("idempotent contact updates are accepted as safe retryable work", async () => {
  const h = harness([row(1)]);
  const claim = await claimed(h, 1);
  assert.deepEqual(
    await failCustomerSync(h.db, claim, {
      kind: "retryable",
      retrySafety: "idempotent_update",
      delayMs: 1000,
      code: "contact_update",
      message: "Retry the same desired-state PUT.",
    }),
    { status: "applied" },
  );
  assert.equal(h.rows.get(1)?.workStatus, "retryable_failed");
});

test("creation attempts block claims and even a live claim cannot complete through one", async () => {
  const h = harness([row(1, { legacyClaim: { status: "creating" } }), row(2)]);
  assert.equal((await claimCustomerSync(h.db, 1, 1000)).status, "needs_reconciliation");
  const claim = await claimed(h, 2);
  h.rows.get(2)!.creationAttemptStatus = "started";
  assert.equal((await completeCustomerSync(h.db, claim)).status, "needs_reconciliation");
  assert.equal(h.rows.get(2)?.creationAttemptStatus, "started");
  assert.equal(h.rows.get(2)?.syncedVersion, 0);
});

test("failed state writes roll back, and invalid retry or duration is rejected", async () => {
  const h = harness([row(1)]);
  h.failWrites(true);
  await assert.rejects(claimCustomerSync(h.db, 1, 1000), /simulated write failure/);
  assert.equal(h.rows.get(1)?.workStatus, "pending");
  assert.equal(h.rows.get(1)?.attemptCount, 0);
  h.failWrites(false);
  const claim = await claimed(h, 1);
  await assert.rejects(failCustomerSync(h.db, claim, {
    kind: "retryable", retrySafety: "no_remote_write", delayMs: 0, code: "failed", message: "Failed",
  }), /delayMs/);
  assert.equal(h.rows.get(1)?.workStatus, "processing");
});
