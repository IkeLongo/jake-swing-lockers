import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, describe, test } from "node:test";
import {
  acknowledgeContactCreation,
  markContactCreationUncertain,
  rejectContactCreation,
  reserveContactCreation,
  reserveStagedContactCreation,
  type ContactCreationAttempt,
} from "../lib/ghl/customerContactCreationCoordinator";
import { enqueueCustomerSync } from "../lib/ghl/customerSyncOutbox";
import { claimCustomerSync } from "../lib/ghl/customerSyncWorkerState";
import { updateGolfClientIfUnique } from "../lib/imports/new-customer-review-store";
import {
  assertCustomerSyncTestDatabaseIdentity,
  createCustomerSyncTestClient,
  getCustomerSyncTestDatabaseConfig,
} from "./helpers/customerSyncTestDatabase";

const skip = process.env.DATABASE_URL_TEST
  ? false
  : "Set DATABASE_URL_TEST to the guarded local test database to run integration tests.";

describe("customer contact creation coordinator MySQL integration", { skip }, () => {
  let db: ReturnType<typeof createCustomerSyncTestClient>;
  let verified = false;
  const fixtureIds: number[] = [];
  const sessionIds: number[] = [];

  before(async () => {
    const config = getCustomerSyncTestDatabaseConfig();
    db = createCustomerSyncTestClient(config);
    await assertCustomerSyncTestDatabaseIdentity(db, config);
    verified = true;
  });
  afterEach(async () => {
    if (verified && sessionIds.length) {
      await db.demoSession.deleteMany({ where: { id: { in: sessionIds.splice(0) } } });
    }
    if (verified && fixtureIds.length) {
      await db.golfClient.deleteMany({ where: { id: { in: fixtureIds.splice(0) } } });
    }
  });
  after(async () => { if (db) await db.$disconnect(); });

  async function fixture() {
    const client = await db.golfClient.create({
      data: { firstName: "Coordinator", email: `coordinator-${randomUUID()}@example.test` },
    });
    fixtureIds.push(client.id);
    await db.$transaction((tx) => enqueueCustomerSync(tx, { golfClientId: client.id, reason: "created" }));
    return client;
  }
  async function stagedSession(clientId: number, ghlSyncState?: object) {
    const session = await db.demoSession.create({
      data: {
        clientId,
        lockerToken: `coordinator-${randomUUID()}`,
        ...(ghlSyncState ? { ghlSyncState } : {}),
      },
    });
    sessionIds.push(session.id);
    return session;
  }
  async function reserve(id: number): Promise<ContactCreationAttempt> {
    const result = await reserveContactCreation(db, { golfClientId: id, expectedVersion: 1 });
    assert.equal(result.status, "reserved");
    if (result.status !== "reserved") throw new Error("reservation failed");
    return result.attempt;
  }

  test("two concurrent reservations produce one durable attempt", async () => {
    const client = await fixture();
    const results = await Promise.all([
      reserveContactCreation(db, { golfClientId: client.id, expectedVersion: 1 }),
      reserveContactCreation(db, { golfClientId: client.id, expectedVersion: 1 }),
    ]);
    assert.equal(results.filter((value) => value.status === "reserved").length, 1);
    assert.equal(results.filter((value) => value.status === "blocked").length, 1);
    const persisted = await db.golfClient.findUniqueOrThrow({ where: { id: client.id }, include: { syncState: true } });
    assert.ok(persisted.ghlContactCreationState);
    assert.equal(persisted.syncState?.creationAttemptStatus, "started");
  });

  test("legacy, malformed, unknown and linked states block new attempts", async () => {
    const client = await fixture();
    for (const legacy of [{ version: 1, status: "creating", sessionId: 1, batchId: 1, attemptedAt: "now" }, "malformed"]) {
      await db.golfClient.update({ where: { id: client.id }, data: { ghlContactCreationState: legacy } });
      assert.equal((await reserveContactCreation(db, { golfClientId: client.id, expectedVersion: 1 })).status, "blocked");
    }
    await db.golfClient.update({ where: { id: client.id }, data: { ghlContactCreationState: { unrelated: true } } });
    assert.equal((await reserveContactCreation(db, { golfClientId: client.id, expectedVersion: 1 })).status, "blocked");
    const other = await fixture();
    await db.golfClientSyncState.update({ where: { golfClientId: other.id }, data: { creationAttemptStatus: "unknown" } });
    assert.equal((await reserveContactCreation(db, { golfClientId: other.id, expectedVersion: 1 })).status, "blocked");
    const linked = await fixture();
    await db.golfClient.update({ where: { id: linked.id }, data: { ghlContactId: `linked-${randomUUID()}` } });
    assert.equal((await reserveContactCreation(db, { golfClientId: linked.id, expectedVersion: 1 })).status, "linked");
  });

  test("acknowledgement is fenced and unique contact ownership is preserved", async () => {
    const customer = await fixture();
    const attempt = await reserve(customer.id);
    assert.equal((await acknowledgeContactCreation(db, { ...attempt, id: randomUUID() }, "contact-stale")).status, "lost_attempt");
    const owner = await fixture();
    const contactId = `c-${randomUUID()}`;
    await db.golfClient.update({ where: { id: owner.id }, data: { ghlContactId: contactId } });
    assert.equal((await acknowledgeContactCreation(db, attempt, contactId)).status, "contact_conflict");
    assert.equal((await db.golfClientSyncState.findUniqueOrThrow({ where: { golfClientId: customer.id } })).creationAttemptId, attempt.id);
    const afterConflict = await db.golfClient.findUniqueOrThrow({ where: { id: customer.id } });
    assert.equal(afterConflict.ghlContactId, null);
    assert.ok(afterConflict.ghlContactCreationState);
    assert.equal((await acknowledgeContactCreation(db, attempt, `c-${randomUUID()}`)).status, "applied");
    const state = await db.golfClientSyncState.findUniqueOrThrow({ where: { golfClientId: customer.id } });
    assert.equal(state.creationAttemptId, null);
    assert.equal(state.syncedVersion, 0);
    assert.equal((await db.golfClient.findUniqueOrThrow({ where: { id: customer.id } })).ghlContactCreationState, null);
  });

  test("rejection clears the attempt for review; uncertain outcomes persist and prevent retries", async () => {
    const rejected = await fixture();
    const first = await reserve(rejected.id);
    assert.equal((await rejectContactCreation(db, first, "rejected", "Rejected")).status, "applied");
    assert.equal((await db.golfClientSyncState.findUniqueOrThrow({ where: { golfClientId: rejected.id } })).workStatus, "needs_review");
    const uncertain = await fixture();
    const second = await reserve(uncertain.id);
    assert.equal((await markContactCreationUncertain(db, second, "timeout", "Unknown")).status, "applied");
    const state = await db.golfClientSyncState.findUniqueOrThrow({ where: { golfClientId: uncertain.id } });
    assert.equal(state.workStatus, "needs_reconciliation");
    assert.equal(state.creationAttemptStatus, "unknown");
    assert.equal((await reserveContactCreation(db, { golfClientId: uncertain.id, expectedVersion: 1 })).status, "blocked");
    assert.equal((await rejectContactCreation(db, second, "rejected", "Rejected")).status, "lost_attempt");
  });

  test("worker lease and token fence acknowledgement; concurrent profile update preserves newer version", async () => {
    const customer = await fixture();
    const claimed = await claimCustomerSync(db, customer.id, 60_000);
    assert.equal(claimed.status, "claimed");
    if (claimed.status !== "claimed") return;
    const reservation = await reserveContactCreation(db, { golfClientId: customer.id, expectedVersion: 1, workerClaim: claimed.claim });
    assert.equal(reservation.status, "reserved");
    if (reservation.status !== "reserved") return;
    const [update, acknowledgement] = await Promise.all([
      updateGolfClientIfUnique(db, customer.id, { firstName: "Changed" }),
      acknowledgeContactCreation(db, reservation.attempt, `c-${randomUUID()}`),
    ]);
    assert.equal(update.status, "updated");
    assert.ok(acknowledgement.status === "applied" || acknowledgement.status === "needs_reconciliation");
    const state = await db.golfClientSyncState.findUniqueOrThrow({ where: { golfClientId: customer.id } });
    assert.equal(state.desiredVersion, 2);
    if (acknowledgement.status === "applied") {
      assert.equal(state.workStatus, "processing");
      assert.equal(state.claimToken, claimed.claim.token);
    } else {
      assert.equal(state.workStatus, "needs_reconciliation");
      assert.equal(state.creationAttemptStatus, "unknown");
      assert.equal((await db.golfClient.findUniqueOrThrow({ where: { id: customer.id } })).ghlContactId, null);
    }
    const expiredCustomer = await fixture();
    const expired = await claimCustomerSync(db, expiredCustomer.id, 60_000);
    assert.equal(expired.status, "claimed");
    if (expired.status !== "claimed") return;
    const pending = await reserveContactCreation(db, { golfClientId: expiredCustomer.id, expectedVersion: 1, workerClaim: expired.claim });
    assert.equal(pending.status, "reserved");
    if (pending.status !== "reserved") return;
    await db.$executeRaw`UPDATE GolfClientSyncState SET leaseExpiresAt = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE golfClientId = ${expiredCustomer.id}`;
    assert.equal((await acknowledgeContactCreation(db, pending.attempt, `c-${randomUUID()}`)).status, "lost_attempt");
    assert.equal((await db.golfClientSyncState.findUniqueOrThrow({ where: { golfClientId: expiredCustomer.id } })).creationAttemptStatus, "started");
  });

  test("staged reservations for different sessions share one customer-scoped attempt", async () => {
    const customer = await fixture();
    const firstSession = await stagedSession(customer.id);
    const secondSession = await stagedSession(customer.id);
    const results = await Promise.all([
      reserveStagedContactCreation(db, {
        golfClientId: customer.id,
        sessionId: firstSession.id,
        batchId: 101,
      }),
      reserveStagedContactCreation(db, {
        golfClientId: customer.id,
        sessionId: secondSession.id,
        batchId: 102,
      }),
    ]);
    assert.equal(results.filter((result) => result.status === "reserved").length, 1);
    assert.equal(results.filter((result) => result.status === "blocked").length, 1);
    const winner = results.find((result) => result.status === "reserved");
    assert.ok(winner?.status === "reserved");
    const persisted = await db.golfClient.findUniqueOrThrow({
      where: { id: customer.id },
      include: { syncState: true },
    });
    assert.equal(persisted.syncState?.creationAttemptId, winner.attempt.id);
    assert.equal(persisted.syncState?.creationAttemptStatus, "started");
    const winnerSessionId = winner.attempt.owner?.sessionId;
    const winnerSession = await db.demoSession.findUniqueOrThrow({ where: { id: winnerSessionId } });
    const loserSessionId = winnerSessionId === firstSession.id ? secondSession.id : firstSession.id;
    const loserSession = await db.demoSession.findUniqueOrThrow({ where: { id: loserSessionId } });
    assert.equal((winnerSession.ghlSyncState as { contact: { attemptId: string } }).contact.attemptId, winner.attempt.id);
    assert.equal(loserSession.ghlSyncState, null);
  });

  test("staged reservation initializes missing sync state and preserves opportunity data on acknowledgement", async () => {
    const client = await db.golfClient.create({
      data: { firstName: "Legacy", email: `legacy-${randomUUID()}@example.test` },
    });
    fixtureIds.push(client.id);
    const opportunity = {
      status: "creating",
      batchId: 77,
      contactId: "opportunity-contact",
      attemptedAt: "preserve",
    };
    const session = await stagedSession(client.id, { version: 1, opportunity });
    const reserved = await reserveStagedContactCreation(db, {
      golfClientId: client.id,
      sessionId: session.id,
      batchId: 77,
      expectedVersion: null,
    });
    assert.equal(reserved.status, "reserved");
    if (reserved.status !== "reserved") return;
    const afterReserve = await db.golfClientSyncState.findUniqueOrThrow({
      where: { golfClientId: client.id },
    });
    assert.equal(afterReserve.desiredVersion, 1);
    assert.equal(afterReserve.creationAttemptId, reserved.attempt.id);

    await db.golfClientSyncState.update({
      where: { golfClientId: client.id },
      data: { desiredVersion: 2 },
    });
    const contactId = `c-${randomUUID()}`;
    assert.equal((await acknowledgeContactCreation(db, reserved.attempt, contactId)).status, "applied");
    const [linked, syncState, resolvedSession] = await Promise.all([
      db.golfClient.findUniqueOrThrow({ where: { id: client.id } }),
      db.golfClientSyncState.findUniqueOrThrow({ where: { golfClientId: client.id } }),
      db.demoSession.findUniqueOrThrow({ where: { id: session.id } }),
    ]);
    assert.equal(linked.ghlContactId, contactId);
    assert.equal(syncState.desiredVersion, 2);
    assert.equal(syncState.syncedVersion, 0);
    assert.equal(syncState.workStatus, "pending");
    assert.equal(syncState.creationAttemptId, null);
    const resolved = resolvedSession.ghlSyncState as {
      opportunity: typeof opportunity;
      contact: { status: string; contactId: string; attemptId: string };
    };
    assert.deepEqual(resolved.opportunity, opportunity);
    assert.equal(resolved.contact.status, "resolved");
    assert.equal(resolved.contact.contactId, contactId);
    assert.equal(resolved.contact.attemptId, reserved.attempt.id);
  });

  test("staged reservation rejects a sync row that appeared after the caller observed no row", async () => {
    const client = await fixture();
    const session = await stagedSession(client.id);
    const result = await reserveStagedContactCreation(db, {
      golfClientId: client.id,
      sessionId: session.id,
      batchId: 78,
      expectedVersion: null,
    });
    assert.deepEqual(result, { status: "blocked", reason: "version_changed" });
    assert.equal((await db.golfClientSyncState.findUniqueOrThrow({
      where: { golfClientId: client.id },
    })).creationAttemptId, null);
    assert.equal((await db.demoSession.findUniqueOrThrow({
      where: { id: session.id },
    })).ghlSyncState, null);
  });

  test("legacy claims, active worker claims, and uncertain staged outcomes remain blocked", async () => {
    const legacy = await fixture();
    const legacySession = await stagedSession(legacy.id);
    await db.golfClient.update({
      where: { id: legacy.id },
      data: {
        ghlContactCreationState: {
          version: 1,
          status: "creating",
          sessionId: legacySession.id,
          batchId: 1,
          attemptedAt: new Date().toISOString(),
        },
      },
    });
    assert.equal((await reserveStagedContactCreation(db, {
      golfClientId: legacy.id,
      sessionId: legacySession.id,
      batchId: 1,
    })).status, "blocked");

    const worker = await fixture();
    const workerClaim = await claimCustomerSync(db, worker.id, 60_000);
    assert.equal(workerClaim.status, "claimed");
    if (workerClaim.status !== "claimed") return;
    const workerSession = await stagedSession(worker.id);
    const workerAttempt = await reserveContactCreation(db, {
      golfClientId: worker.id,
      expectedVersion: 1,
      workerClaim: workerClaim.claim,
    });
    assert.equal(workerAttempt.status, "reserved");
    assert.equal((await reserveStagedContactCreation(db, {
      golfClientId: worker.id,
      sessionId: workerSession.id,
      batchId: 2,
    })).status, "blocked");

    const uncertain = await fixture();
    const uncertainSession = await stagedSession(uncertain.id);
    const rejected = await fixture();
    const rejectedSession = await stagedSession(rejected.id, {
      version: 1,
      opportunity: {
        status: "creating",
        batchId: 3,
        contactId: "keep-opportunity",
        attemptedAt: "preserve",
      },
    });
    const rejectedAttempt = await reserveStagedContactCreation(db, {
      golfClientId: rejected.id,
      sessionId: rejectedSession.id,
      batchId: 3,
    });
    assert.equal(rejectedAttempt.status, "reserved");
    if (rejectedAttempt.status !== "reserved") return;
    assert.equal((await rejectContactCreation(db, rejectedAttempt.attempt, "rejected", "Rejected")).status, "applied");
    const rejectedState = (await db.demoSession.findUniqueOrThrow({
      where: { id: rejectedSession.id },
    })).ghlSyncState as { opportunity: { contactId: string }; contact?: unknown };
    assert.equal(rejectedState.opportunity.contactId, "keep-opportunity");
    assert.equal(rejectedState.contact, undefined);

    const attempt = await reserveStagedContactCreation(db, {
      golfClientId: uncertain.id,
      sessionId: uncertainSession.id,
      batchId: 3,
    });
    assert.equal(attempt.status, "reserved");
    if (attempt.status !== "reserved") return;
    assert.equal((await markContactCreationUncertain(db, attempt.attempt, "timeout", "Unknown")).status, "applied");
    assert.equal((await reserveStagedContactCreation(db, {
      golfClientId: uncertain.id,
      sessionId: uncertainSession.id,
      batchId: 3,
    })).status, "blocked");
    const [syncState, staged] = await Promise.all([
      db.golfClientSyncState.findUniqueOrThrow({ where: { golfClientId: uncertain.id } }),
      db.demoSession.findUniqueOrThrow({ where: { id: uncertainSession.id } }),
    ]);
    assert.equal(syncState.creationAttemptStatus, "unknown");
    assert.equal((staged.ghlSyncState as { contact: { attemptId: string } }).contact.attemptId, attempt.attempt.id);
  });

  test("staged acknowledgement rolls back customer and session changes on contact ownership conflict", async () => {
    const customer = await fixture();
    const session = await stagedSession(customer.id);
    const reserved = await reserveStagedContactCreation(db, {
      golfClientId: customer.id,
      sessionId: session.id,
      batchId: 9,
    });
    assert.equal(reserved.status, "reserved");
    if (reserved.status !== "reserved") return;
    assert.equal((await acknowledgeContactCreation(db, {
      ...reserved.attempt,
      owner: { kind: "staged", sessionId: session.id + 1, batchId: 10 },
    }, `c-${randomUUID()}`)).status, "lost_attempt");

    const existingOwner = await fixture();
    const contactId = `c-${randomUUID()}`;
    await db.golfClient.update({
      where: { id: existingOwner.id },
      data: { ghlContactId: contactId },
    });
    assert.equal((await acknowledgeContactCreation(db, reserved.attempt, contactId)).status, "contact_conflict");

    const [persistedCustomer, state, persistedSession] = await Promise.all([
      db.golfClient.findUniqueOrThrow({ where: { id: customer.id } }),
      db.golfClientSyncState.findUniqueOrThrow({ where: { golfClientId: customer.id } }),
      db.demoSession.findUniqueOrThrow({ where: { id: session.id } }),
    ]);
    assert.equal(persistedCustomer.ghlContactId, null);
    assert.ok(persistedCustomer.ghlContactCreationState);
    assert.equal(state.creationAttemptId, reserved.attempt.id);
    assert.equal(state.creationAttemptStatus, "started");
    assert.equal((persistedSession.ghlSyncState as { contact: { status: string; attemptId: string } }).contact.status, "creating");
    assert.equal((persistedSession.ghlSyncState as { contact: { attemptId: string } }).contact.attemptId, reserved.attempt.id);
  });
});
