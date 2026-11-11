import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Prisma } from "../app/generated/prisma/client";
import {
  acknowledgeContactCreation,
  linkVerifiedCustomerContact,
  markContactCreationUncertain,
  rejectContactCreation,
  reserveContactCreation,
  reserveStagedContactCreation,
  type ContactCreationAttempt,
} from "../lib/ghl/customerContactCreationCoordinator";

type Client = {
  ghlContactId: string | null;
  ghlContactCreationState: unknown;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
};
interface Session {
  id: number;
  clientId: number;
  ghlSyncState: unknown;
  ghlSyncStatus: string | null;
  ghlSyncError: string | null;
}
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
  contactVerificationStatus: string;
  verifiedGhlLocationId: string | null;
  contactVerifiedAt: number | null;
}

function harness(over: {
  client?: Partial<Client>;
  state?: Partial<State>;
  missingState?: boolean;
  sessions?: Session[];
  failSessionWrite?: boolean;
  otherOwners?: { id: number; ghlContactId: string }[];
} = {}) {
  let client: Client = {
    ghlContactId: null,
    ghlContactCreationState: null,
    firstName: "Ann",
    lastName: "Lee",
    email: "ann@example.com",
    phone: "+12105550100",
    ...over.client,
  };
  let state: State = {
    desiredVersion: 1, syncedVersion: 0, workStatus: "pending",
    claimToken: null, claimedVersion: null, leaseExpiresAt: null,
    creationAttemptId: null, creationAttemptVersion: null,
    creationAttemptStatus: null, creationAttemptedAt: null,
    nextAttemptAt: null, lastErrorCode: null, lastError: null,
    contactVerificationStatus: "unverified",
    verifiedGhlLocationId: null,
    contactVerifiedAt: null,
    ...over.state,
  };
  let stateExists = !over.missingState;
  let sessions = new Map((over.sessions ?? [
    { id: 10, clientId: 1, ghlSyncState: null, ghlSyncStatus: null, ghlSyncError: null },
    { id: 11, clientId: 1, ghlSyncState: null, ghlSyncStatus: null, ghlSyncError: null },
  ]).map((session) => [session.id, { ...session }]));
  let tail = Promise.resolve();
  let now = 1000;
  let failCustomerWrite = false;
  let failSessionWrite = over.failSessionWrite ?? false;
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
      let currentStateExists = stateExists;
      const currentSessions = new Map([...sessions].map(([id, session]) => [id, { ...session }]));
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
          if (query.includes("FROM GolfClientSyncState")) {
            return currentStateExists ? [{ golfClientId: 1 }] : [];
          }
          if (query.includes("FROM DemoSession")) {
            const session = currentSessions.get(Number(values[0]));
            return session ? [{ id: session.id }] : [];
          }
          return [{ id: 1, golfClientId: 1 }];
        },
        golfClient: {
          async findUniqueOrThrow() { return { ...currentClient }; },
          async findUnique(args: { where: { ghlContactId: string } }) {
            if (currentClient.ghlContactId === args.where.ghlContactId) {
              return { id: 1 };
            }
            return over.otherOwners?.find(
              (owner) => owner.ghlContactId === args.where.ghlContactId,
            ) ?? null;
          },
          async updateMany(args: {
            where: { id: number; OR: { ghlContactId: string | null }[] };
            data: { ghlContactId: string };
          }) {
            if (
              args.where.id !== 1 ||
              !args.where.OR.some((entry) =>
                entry.ghlContactId === currentClient.ghlContactId,
              )
            ) return { count: 0 };
            currentClient.ghlContactId = args.data.ghlContactId;
            return { count: 1 };
          },
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
          async create(args: { data: Partial<State> & { golfClientId: number } }) {
            Object.assign(currentState, args.data);
            currentStateExists = true;
            return { ...currentState };
          },
        },
        demoSession: {
          async findUniqueOrThrow(args: { where: { id: number } }) {
            const session = currentSessions.get(args.where.id);
            if (!session) throw new Error("session not found");
            return { ...session };
          },
          async update(args: {
            where: { id: number };
            data: Partial<Session> & { ghlSyncState?: unknown };
          }) {
            if (failSessionWrite) throw new Error("session write failed");
            const session = currentSessions.get(args.where.id);
            if (!session) throw new Error("session not found");
            Object.assign(session, args.data);
            if (args.data.ghlSyncState === Prisma.DbNull) session.ghlSyncState = null;
            return session;
          },
        },
        async $executeRaw(parts: TemplateStringsArray, ...values: (string | number | boolean | null)[]) {
          const query = parts.join("?");
          sql.push(query);
          if (!currentStateExists) return 0;
          if (query.includes("contactVerificationStatus = 'verified'")) {
            const [locationId, id, token, claimedVersion, desiredVersion] = values;
            if (
              Number(id) !== 1 ||
              currentState.workStatus !== "processing" ||
              currentState.claimToken !== token ||
              currentState.claimedVersion !== claimedVersion ||
              currentState.desiredVersion !== desiredVersion ||
              currentState.leaseExpiresAt === null ||
              currentState.leaseExpiresAt <= now ||
              currentState.creationAttemptId !== null ||
              currentState.creationAttemptVersion !== null ||
              currentState.creationAttemptStatus !== null ||
              currentState.creationAttemptedAt !== null
            ) return 0;
            currentState.contactVerificationStatus = "verified";
            currentState.verifiedGhlLocationId = String(locationId);
            currentState.contactVerifiedAt = now;
            return 1;
          }
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
        stateExists = currentStateExists;
        sessions = currentSessions;
        return result;
      } finally { release(); }
    },
  };
  return {
    db: db as never,
    get client() { return client; },
    get state() { return state; },
    get stateExists() { return stateExists; },
    get sessions() { return sessions; },
    statements,
    advance(ms: number) { now += ms; },
    setState(patch: Partial<State>) { state = { ...state, ...patch }; },
    failCustomerWrite(value: boolean) { failCustomerWrite = value; },
    failSessionWrite(value: boolean) { failSessionWrite = value; },
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

test("staged reservations serialize different sessions and lock customer, sync state, then session", async () => {
  const h = harness();
  const results = await Promise.all([
    reserveStagedContactCreation(h.db, { golfClientId: 1, sessionId: 10, batchId: 20 }),
    reserveStagedContactCreation(h.db, { golfClientId: 1, sessionId: 11, batchId: 21 }),
  ]);
  assert.deepEqual(results.map((result) => result.status), ["reserved", "blocked"]);
  const reserved = results.find((result) => result.status === "reserved");
  assert.ok(reserved?.status === "reserved");
  assert.deepEqual(reserved.attempt.owner, { kind: "staged", sessionId: 10, batchId: 20 });
  assert.equal(h.sessions.get(10)?.ghlSyncState && (h.sessions.get(10)?.ghlSyncState as { contact?: { attemptId: string } }).contact?.attemptId, reserved.attempt.id);
  assert.equal(h.sessions.get(11)?.ghlSyncState, null);
  const reservedTransaction = h.statements.find((sql) =>
    sql.some((query) => query.includes("FROM DemoSession")),
  );
  assert.ok(reservedTransaction);
  assert.match(reservedTransaction[0]!, /FROM GolfClient WHERE/);
  assert.match(reservedTransaction[1]!, /FROM GolfClientSyncState WHERE/);
  assert.match(reservedTransaction[2]!, /FROM DemoSession WHERE/);
});

test("staged reservation initializes missing state but legacy claims and worker ownership block it", async () => {
  const missing = harness({ missingState: true });
  const result = await reserveStagedContactCreation(missing.db, {
    golfClientId: 1,
    sessionId: 10,
    batchId: 20,
  });
  assert.equal(result.status, "reserved");
  assert.equal(missing.stateExists, true);
  assert.equal(missing.state.desiredVersion, 1);
  assert.equal(missing.state.creationAttemptStatus, "started");

  const legacy = harness({
    client: { ghlContactCreationState: { version: 1, status: "creating", sessionId: 10, batchId: 20, attemptedAt: "now" } },
    missingState: true,
  });
  assert.deepEqual(await reserveStagedContactCreation(legacy.db, {
    golfClientId: 1,
    sessionId: 10,
    batchId: 20,
  }), { status: "blocked", reason: "attempt_unresolved" });
  assert.equal(legacy.stateExists, false);

  for (const leaseExpiresAt of [2000, 999]) {
    const workerOwned = harness({
      state: {
        workStatus: "processing",
        claimToken: randomUUID(),
        claimedVersion: 1,
        leaseExpiresAt,
      },
    });
    assert.deepEqual(await reserveStagedContactCreation(workerOwned.db, {
      golfClientId: 1,
      sessionId: 10,
      batchId: 20,
    }), { status: "blocked", reason: "work_not_available" });
  }

  const token = randomUUID();
  const workerAttempt = harness({
    state: {
      workStatus: "processing",
      claimToken: token,
      claimedVersion: 1,
      leaseExpiresAt: 2000,
    },
  });
  const workerReservation = await reserveContactCreation(workerAttempt.db, {
    golfClientId: 1,
    expectedVersion: 1,
    workerClaim: { golfClientId: 1, token, version: 1 },
  });
  assert.equal(workerReservation.status, "reserved");
  assert.deepEqual(await reserveStagedContactCreation(workerAttempt.db, {
    golfClientId: 1,
    sessionId: 10,
    batchId: 20,
  }), { status: "blocked", reason: "attempt_unresolved" });
});

test("staged acknowledgement atomically links and resolves without losing newer version or opportunity", async () => {
  const opportunity = {
    status: "creating",
    batchId: 20,
    contactId: "existing-contact",
    attemptedAt: "now",
  };
  const h = harness({
    sessions: [
      { id: 10, clientId: 1, ghlSyncState: { version: 1, opportunity }, ghlSyncStatus: null, ghlSyncError: null },
    ],
  });
  const reserved = await reserveStagedContactCreation(h.db, {
    golfClientId: 1,
    sessionId: 10,
    batchId: 20,
  });
  assert.equal(reserved.status, "reserved");
  if (reserved.status !== "reserved") return;
  h.setState({ desiredVersion: 2 });
  assert.deepEqual(await acknowledgeContactCreation(h.db, reserved.attempt, "contact-staged"), { status: "applied" });
  assert.equal(h.client.ghlContactId, "contact-staged");
  assert.equal(h.state.desiredVersion, 2);
  assert.equal(h.state.syncedVersion, 0);
  assert.equal(h.state.workStatus, "pending");
  assert.equal(h.state.creationAttemptId, null);
  const sessionState = h.sessions.get(10)?.ghlSyncState as {
    opportunity: typeof opportunity;
    contact: { status: string; contactId: string; attemptId: string };
  };
  assert.deepEqual(sessionState.opportunity, opportunity);
  assert.equal(sessionState.contact.status, "resolved");
  assert.equal(sessionState.contact.contactId, "contact-staged");
  assert.equal(sessionState.contact.attemptId, reserved.attempt.id);
});

test("staged transitions fence stale owners and keep rejection or uncertainty consistent", async () => {
  const rejected = harness();
  const first = await reserveStagedContactCreation(rejected.db, {
    golfClientId: 1,
    sessionId: 10,
    batchId: 20,
  });
  assert.equal(first.status, "reserved");
  if (first.status !== "reserved") return;
  assert.equal((await acknowledgeContactCreation(rejected.db, {
    ...first.attempt,
    owner: { kind: "staged", sessionId: 11, batchId: 21 },
  }, "stale-contact")).status, "lost_attempt");
  assert.equal((await rejectContactCreation(rejected.db, first.attempt, "rejected", "Rejected")).status, "applied");
  assert.equal(rejected.state.workStatus, "needs_review");
  assert.equal(rejected.state.creationAttemptId, null);
  assert.equal(rejected.client.ghlContactCreationState, null);
  assert.equal(rejected.sessions.get(10)?.ghlSyncState, null);

  const uncertain = harness();
  const second = await reserveStagedContactCreation(uncertain.db, {
    golfClientId: 1,
    sessionId: 10,
    batchId: 20,
  });
  assert.equal(second.status, "reserved");
  if (second.status !== "reserved") return;
  assert.equal((await markContactCreationUncertain(uncertain.db, second.attempt, "timeout", "Unknown")).status, "applied");
  assert.equal(uncertain.state.workStatus, "needs_reconciliation");
  assert.equal(uncertain.state.creationAttemptStatus, "unknown");
  assert.ok(uncertain.client.ghlContactCreationState);
  const sessionState = uncertain.sessions.get(10)?.ghlSyncState as { contact: { attemptId: string } };
  assert.equal(sessionState.contact.attemptId, second.attempt.id);
});

test("staged reservation and completion roll back together when either record write fails", async () => {
  const reserveFailure = harness({ failSessionWrite: true });
  await assert.rejects(reserveStagedContactCreation(reserveFailure.db, {
    golfClientId: 1,
    sessionId: 10,
    batchId: 20,
  }), /session write failed/);
  assert.equal(reserveFailure.state.creationAttemptId, null);
  assert.equal(reserveFailure.client.ghlContactCreationState, null);
  assert.equal(reserveFailure.sessions.get(10)?.ghlSyncState, null);

  const completionFailure = harness();
  const reserved = await reserveStagedContactCreation(completionFailure.db, {
    golfClientId: 1,
    sessionId: 10,
    batchId: 20,
  });
  assert.equal(reserved.status, "reserved");
  if (reserved.status !== "reserved") return;
  completionFailure.failSessionWrite(true);
  await assert.rejects(
    acknowledgeContactCreation(completionFailure.db, reserved.attempt, "contact-staged"),
    /session write failed/,
  );
  assert.equal(completionFailure.client.ghlContactId, null);
  assert.equal(completionFailure.state.creationAttemptId, reserved.attempt.id);
  assert.ok(completionFailure.client.ghlContactCreationState);
  assert.equal(
    (completionFailure.sessions.get(10)?.ghlSyncState as { contact: { status: string } }).contact.status,
    "creating",
  );
});

test("verified existing contact linking persists verification without completing sync", async () => {
  const token = randomUUID();
  const claim = { golfClientId: 1, token, version: 1 };
  const h = harness({
    state: {
      workStatus: "processing",
      claimToken: token,
      claimedVersion: 1,
      leaseExpiresAt: 2000,
    },
  });

  assert.deepEqual(await linkVerifiedCustomerContact(h.db, {
    claim,
    contactId: "contact-verified",
    verifiedLocationId: "location-1",
    expectedIdentity: {
      firstName: "Ann",
      lastName: "Lee",
      email: "Ann@Example.com",
      phone: "(210) 555-0100",
    },
  }), { status: "linked" });

  assert.equal(h.client.ghlContactId, "contact-verified");
  assert.equal(h.state.contactVerificationStatus, "verified");
  assert.equal(h.state.verifiedGhlLocationId, "location-1");
  assert.ok(h.state.contactVerifiedAt);
  assert.equal(h.state.workStatus, "processing");
  assert.equal(h.state.claimToken, token);
  assert.equal(h.state.syncedVersion, 0);
});

test("verified contact linking rejects stale claims, changed identity, and newer versions", async () => {
  const token = randomUUID();
  const input = {
    claim: { golfClientId: 1, token, version: 1 },
    contactId: "contact-verified",
    verifiedLocationId: "location-1",
    expectedIdentity: {
      firstName: "Ann",
      lastName: "Lee",
      email: "ann@example.com",
      phone: "+12105550100",
    },
  };
  const stale = harness({
    state: {
      workStatus: "processing",
      claimToken: randomUUID(),
      claimedVersion: 1,
      leaseExpiresAt: 2000,
    },
  });
  assert.deepEqual(await linkVerifiedCustomerContact(stale.db, input), { status: "lost_claim" });

  const changedIdentity = harness({
    client: { email: "new@example.com" },
    state: {
      workStatus: "processing",
      claimToken: token,
      claimedVersion: 1,
      leaseExpiresAt: 2000,
    },
  });
  assert.deepEqual(await linkVerifiedCustomerContact(changedIdentity.db, input), { status: "identity_changed" });
  assert.equal(changedIdentity.client.ghlContactId, null);

  const newerVersion = harness({
    state: {
      workStatus: "processing",
      claimToken: token,
      claimedVersion: 1,
      desiredVersion: 2,
      leaseExpiresAt: 2000,
    },
  });
  assert.deepEqual(await linkVerifiedCustomerContact(newerVersion.db, input), { status: "version_changed" });
  assert.equal(newerVersion.state.desiredVersion, 2);
  assert.equal(newerVersion.state.syncedVersion, 0);
  assert.equal(newerVersion.state.workStatus, "processing");
});

test("verified contact linking rejects unresolved creation attempts and another owner", async () => {
  const token = randomUUID();
  const input = {
    claim: { golfClientId: 1, token, version: 1 },
    contactId: "contact-verified",
    verifiedLocationId: "location-1",
    expectedIdentity: {
      firstName: "Ann",
      lastName: "Lee",
      email: "ann@example.com",
      phone: "+12105550100",
    },
  };
  const attempt = harness({
    state: {
      workStatus: "processing",
      claimToken: token,
      claimedVersion: 1,
      leaseExpiresAt: 2000,
      creationAttemptStatus: "unknown",
    },
  });
  assert.deepEqual(await linkVerifiedCustomerContact(attempt.db, input), { status: "attempt_unresolved" });
  assert.equal(attempt.client.ghlContactId, null);

  const owned = harness({
    state: {
      workStatus: "processing",
      claimToken: token,
      claimedVersion: 1,
      leaseExpiresAt: 2000,
    },
    otherOwners: [{ id: 2, ghlContactId: "contact-verified" }],
  });
  assert.deepEqual(await linkVerifiedCustomerContact(owned.db, input), { status: "contact_conflict" });
  assert.equal(owned.client.ghlContactId, null);
});
