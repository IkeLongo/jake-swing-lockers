import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  acknowledgeContactCreation,
  markContactCreationUncertain,
  rejectContactCreation,
  reserveContactCreation,
  type ContactCreationAttempt,
} from "../lib/ghl/customerContactCreationCoordinator";

type Client = { ghlContactId: string | null; ghlContactCreationState: unknown };
interface State {
  desiredVersion: number;
  syncedVersion: number;
  workStatus: string;
  claimToken: string | null;
  claimedVersion: number | null;
  leaseExpiresAt: number | null;
  creationAttemptId: string | null;
  creationAttemptVersion: number | null;
  creationAttemptStatus: string | null;
  creationAttemptedAt: number | null;
  nextAttemptAt: number | null;
  lastErrorCode: string | null;
  lastError: string | null;
}

function harness(over: { client?: Partial<Client>; state?: Partial<State> } = {}) {
  let client: Client = { ghlContactId: null, ghlContactCreationState: null, ...over.client };
  let state: State = {
    desiredVersion: 1, syncedVersion: 0, workStatus: "pending",
    claimToken: null, claimedVersion: null, leaseExpiresAt: null,
    creationAttemptId: null, creationAttemptVersion: null,
    creationAttemptStatus: null, creationAttemptedAt: null,
    nextAttemptAt: null, lastErrorCode: null, lastError: null,
    ...over.state,
  };
  let tail = Promise.resolve();
  let now = 1000;
  let failCustomerWrite = false;
  let expireAtFinalCheck = false;
  const statements: string[][] = [];
  const db = {
    async $transaction<T>(callback: (tx: never) => Promise<T>): Promise<T> {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      let currentClient = { ...client };
      const currentState = { ...state };
      const sql: string[] = [];
      statements.push(sql);
      const tx = {
        async $queryRaw(parts: TemplateStringsArray, ...values: unknown[]) {
          const query = parts.join("?");
          sql.push(query);
          if (query.includes("AS valid")) {
            if (expireAtFinalCheck && currentState.leaseExpiresAt !== null) now = currentState.leaseExpiresAt;
            return [{
              valid: Number(currentState.workStatus === "processing" &&
                currentState.claimToken === values[1] && currentState.claimedVersion === values[2] &&
                currentState.leaseExpiresAt !== null && currentState.leaseExpiresAt > now),
            }];
          }
          return [{ id: 1, golfClientId: 1 }];
        },
        golfClient: {
          async findUniqueOrThrow() { return { ...currentClient }; },
          async update(args: { data: { ghlContactId?: string; ghlContactCreationState: unknown } }) {
            if (failCustomerWrite) throw new Error("customer write failed");
            currentClient = {
              ...currentClient,
              ...args.data,
              ghlContactCreationState: typeof args.data.ghlContactCreationState === "object" &&
                args.data.ghlContactCreationState !== null &&
                !("attemptId" in args.data.ghlContactCreationState)
                ? null : args.data.ghlContactCreationState,
            };
          },
        },
        golfClientSyncState: {
          async findUniqueOrThrow() { return { ...currentState }; },
        },
        async $executeRaw(parts: TemplateStringsArray, ...values: (string | number | boolean | null)[]) {
          const query = parts.join("?");
          sql.push(query);
          if (query.includes("SET claimToken = NULL")) {
            if (expireAtFinalCheck && currentState.leaseExpiresAt !== null) now = currentState.leaseExpiresAt;
            const [, status, token, version] = values;
            if (currentState.workStatus !== status || currentState.claimToken !== token ||
              currentState.claimedVersion !== version || currentState.leaseExpiresAt === null ||
              currentState.leaseExpiresAt <= now) return 0;
            currentState.claimToken = null;
            currentState.claimedVersion = null;
            currentState.leaseExpiresAt = null;
            return 1;
          }
          if (query.includes("creationAttemptVersion = ?, creationAttemptStatus = 'started'")) {
            const [id, version, , ...extra] = values;
            if (currentState.desiredVersion !== version) return 0;
            if (query.includes("workStatus = 'processing'")) {
              if (currentState.workStatus !== "processing" ||
                currentState.claimToken !== extra[0] || currentState.claimedVersion !== extra[1] ||
                currentState.leaseExpiresAt === null || currentState.leaseExpiresAt <= now) return 0;
            } else if (currentState.workStatus !== "pending") return 0;
            currentState.creationAttemptId = String(id);
            currentState.creationAttemptVersion = Number(version);
            currentState.creationAttemptStatus = "started";
            currentState.creationAttemptedAt = now;
            return 1;
          }
          const worker = query.includes("workStatus = 'processing' AND claimToken");
          const [status, id, version, attemptStatus, clear, ...remaining] = values;
          const suffix = worker ? remaining.slice(-5) : remaining.slice(-3);
          const attemptId = suffix[1];
          const attemptVersion = suffix[2];
          if (currentState.creationAttemptId !== attemptId ||
            currentState.creationAttemptVersion !== attemptVersion ||
            currentState.creationAttemptStatus !== "started") return 0;
          if (worker) {
            if (currentState.workStatus !== "processing" ||
              currentState.claimToken !== suffix[3] || currentState.claimedVersion !== suffix[4] ||
              currentState.leaseExpiresAt === null || currentState.leaseExpiresAt <= now) return 0;
          } else if (currentState.workStatus !== "pending") return 0;
          currentState.workStatus = String(status);
          currentState.creationAttemptId = id === null ? null : String(id);
          currentState.creationAttemptVersion = version === null ? null : Number(version);
          currentState.creationAttemptStatus = attemptStatus === null ? null : String(attemptStatus);
          if (clear) currentState.creationAttemptedAt = null;
          return 1;
        },
      };
      try {
        const result = await callback(tx as never);
        client = currentClient;
        state = currentState;
        return result;
      } finally { release(); }
    },
  };
  return {
    db: db as never,
    get client() { return client; },
    get state() { return state; },
    statements,
    advance(ms: number) { now += ms; },
    setState(patch: Partial<State>) { state = { ...state, ...patch }; },
    failCustomerWrite(value: boolean) { failCustomerWrite = value; },
    expireOnFinalCheck() { expireAtFinalCheck = true; },
  };
}

async function reserve(h: ReturnType<typeof harness>): Promise<ContactCreationAttempt> {
  const result = await reserveContactCreation(h.db, { golfClientId: 1, expectedVersion: 1 });
  assert.equal(result.status, "reserved");
  if (result.status !== "reserved") throw new Error("reservation failed");
  return result.attempt;
}

test("concurrent reservations serialize, create both markers and lock customer first", async () => {
  const h = harness();
  const results = await Promise.all([
    reserveContactCreation(h.db, { golfClientId: 1, expectedVersion: 1 }),
    reserveContactCreation(h.db, { golfClientId: 1, expectedVersion: 1 }),
  ]);
  assert.deepEqual(results.map((result) => result.status), ["reserved", "blocked"]);
  assert.equal(h.state.creationAttemptStatus, "started");
  assert.ok(h.client.ghlContactCreationState);
  for (const sql of h.statements) {
    assert.match(sql[0]!, /FROM GolfClient WHERE/);
    assert.match(sql[1]!, /FROM GolfClientSyncState WHERE/);
  }
});

test("existing links, legacy markers and partial or unknown attempts block reservation", async () => {
  const linked = harness({ client: { ghlContactId: "linked" } });
  assert.deepEqual(await reserveContactCreation(linked.db, { golfClientId: 1, expectedVersion: 1 }), { status: "linked", contactId: "linked" });
  for (const value of [{ version: 1, status: "creating" }, "malformed", { status: "unknown" }]) {
    const h = harness({ client: { ghlContactCreationState: value } });
    assert.equal((await reserveContactCreation(h.db, { golfClientId: 1, expectedVersion: 1 })).status, "blocked");
  }
  for (const partial of [{ creationAttemptId: randomUUID() }, { creationAttemptStatus: "unknown" }, { creationAttemptVersion: 1 }]) {
    const h = harness({ state: partial });
    assert.equal((await reserveContactCreation(h.db, { golfClientId: 1, expectedVersion: 1 })).status, "blocked");
  }
});

test("acknowledgement records the contact and clears both matching markers", async () => {
  const h = harness();
  const attempt = await reserve(h);
  assert.deepEqual(await acknowledgeContactCreation(h.db, { ...attempt, id: randomUUID() }, "contact-1"), { status: "lost_attempt" });
  assert.deepEqual(await acknowledgeContactCreation(h.db, attempt, "contact-1"), { status: "applied" });
  assert.equal(h.client.ghlContactId, "contact-1");
  assert.equal(h.client.ghlContactCreationState, null);
  assert.equal(h.state.creationAttemptId, null);
  assert.equal(h.state.syncedVersion, 0);
  assert.deepEqual(await acknowledgeContactCreation(h.db, attempt, "contact-1"), { status: "lost_attempt" });
});

test("definitive rejection blocks for review; uncertain outcome retains attempt and blocks retries", async () => {
  const rejected = harness();
  const first = await reserve(rejected);
  assert.deepEqual(await rejectContactCreation(rejected.db, first, "rejected", "Rejected"), { status: "applied" });
  assert.equal(rejected.state.workStatus, "needs_review");
  assert.equal(rejected.state.creationAttemptId, null);
  const uncertain = harness();
  const second = await reserve(uncertain);
  assert.deepEqual(await markContactCreationUncertain(uncertain.db, second, "timeout", "Unknown"), { status: "applied" });
  assert.equal(uncertain.state.workStatus, "needs_reconciliation");
  assert.equal(uncertain.state.creationAttemptStatus, "unknown");
  assert.ok(uncertain.client.ghlContactCreationState);
  assert.equal((await reserveContactCreation(uncertain.db, { golfClientId: 1, expectedVersion: 1 })).status, "blocked");
  assert.deepEqual(await rejectContactCreation(uncertain.db, second, "no", "No"), { status: "lost_attempt" });
});

test("an older reservation cannot clear a later reservation", async () => {
  const h = harness();
  const first = await reserve(h);
  assert.equal((await rejectContactCreation(h.db, first, "rejected", "Rejected")).status, "applied");
  h.setState({ workStatus: "pending" });
  const second = await reserve(h);
  assert.notEqual(first.id, second.id);
  assert.equal((await acknowledgeContactCreation(h.db, first, "old-contact")).status, "lost_attempt");
  assert.equal(h.state.creationAttemptId, second.id);
  assert.equal(h.client.ghlContactId, null);
});

test("standalone reservation remains blocked when intervening work requires reconciliation", async () => {
  const h = harness();
  const attempt = await reserve(h);
  h.setState({ desiredVersion: 2, workStatus: "needs_reconciliation" });
  assert.equal((await acknowledgeContactCreation(h.db, attempt, "contact-1")).status, "lost_attempt");
  assert.equal(h.state.creationAttemptId, attempt.id);
  assert.ok(h.client.ghlContactCreationState);
});

test("worker reservations are fenced by claim and expiry when profile version advances", async () => {
  const token = randomUUID();
  const h = harness({ state: { workStatus: "processing", claimToken: token, claimedVersion: 1, leaseExpiresAt: 2000 } });
  const claim = { golfClientId: 1, token, version: 1 };
  assert.equal((await reserveContactCreation(h.db, { golfClientId: 1, expectedVersion: 1, workerClaim: { ...claim, token: randomUUID() } })).status, "blocked");
  const result = await reserveContactCreation(h.db, { golfClientId: 1, expectedVersion: 1, workerClaim: claim });
  assert.equal(result.status, "reserved");
  if (result.status !== "reserved") return;
  h.setState({ desiredVersion: 2 });
  assert.deepEqual(await acknowledgeContactCreation(h.db, result.attempt, "contact-1"), { status: "needs_reconciliation" });
  assert.equal(h.state.desiredVersion, 2);
  assert.equal(h.state.workStatus, "needs_reconciliation");
  assert.equal(h.state.creationAttemptStatus, "unknown");
  assert.equal(h.client.ghlContactId, null);
  const expired = harness({ state: { workStatus: "processing", claimToken: token, claimedVersion: 1, leaseExpiresAt: 2000 } });
  const reservation = await reserveContactCreation(expired.db, { golfClientId: 1, expectedVersion: 1, workerClaim: claim });
  assert.equal(reservation.status, "reserved");
  if (reservation.status !== "reserved") return;
  expired.advance(1000);
  assert.deepEqual(await acknowledgeContactCreation(expired.db, reservation.attempt, "contact-1"), { status: "lost_attempt" });
  assert.equal(expired.state.creationAttemptStatus, "started");
});

test("worker acknowledgement succeeds only while its lease remains valid through commit checks", async () => {
  const token = randomUUID();
  const claim = { golfClientId: 1, token, version: 1 };
  const config = { workStatus: "processing", claimToken: token, claimedVersion: 1, leaseExpiresAt: 2000 };
  const successful = harness({ state: config });
  const result = await reserveContactCreation(successful.db, { golfClientId: 1, expectedVersion: 1, workerClaim: claim });
  assert.equal(result.status, "reserved");
  if (result.status !== "reserved") return;
  assert.equal((await acknowledgeContactCreation(successful.db, result.attempt, "contact-1")).status, "applied");
  assert.equal(successful.state.workStatus, "processing");
  assert.equal(successful.state.claimToken, token);

  const expiring = harness({ state: config });
  const second = await reserveContactCreation(expiring.db, { golfClientId: 1, expectedVersion: 1, workerClaim: claim });
  assert.equal(second.status, "reserved");
  if (second.status !== "reserved") return;
  expiring.expireOnFinalCheck();
  assert.equal((await acknowledgeContactCreation(expiring.db, second.attempt, "contact-2")).status, "lost_attempt");
  assert.equal(expiring.client.ghlContactId, null);
  assert.equal(expiring.state.creationAttemptId, second.attempt.id);
});

test("reservation and acknowledgement roll back if updating the customer fails", async () => {
  const h = harness();
  h.failCustomerWrite(true);
  await assert.rejects(reserve(h), /customer write failed/);
  assert.equal(h.state.creationAttemptId, null);
  h.failCustomerWrite(false);
  const attempt = await reserve(h);
  h.failCustomerWrite(true);
  await assert.rejects(acknowledgeContactCreation(h.db, attempt, "contact-1"), /customer write failed/);
  assert.equal(h.state.creationAttemptId, attempt.id);
  assert.ok(h.client.ghlContactCreationState);
});
