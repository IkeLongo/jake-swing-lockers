import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, describe, test } from "node:test";
import {
  acknowledgeContactCreation,
  markContactCreationUncertain,
  rejectContactCreation,
  reserveContactCreation,
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

  before(async () => {
    const config = getCustomerSyncTestDatabaseConfig();
    db = createCustomerSyncTestClient(config);
    await assertCustomerSyncTestDatabaseIdentity(db, config);
    verified = true;
  });
  afterEach(async () => {
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
});
