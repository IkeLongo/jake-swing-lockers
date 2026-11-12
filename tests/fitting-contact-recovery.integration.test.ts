import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { claimFittingSync, releaseFittingSync } from "../lib/ghl/fittingSyncClaim";
import { confirmFittingContactRecovery, inspectFittingContactRecovery } from "../lib/ghl/recoverFittingContact";
import { computeApprovalSignature, resolveBatchLocalIdentity, type GhlReviewSnapshot } from "../lib/imports/ghl-contact-approval";
import {
  assertCustomerSyncTestDatabaseIdentity,
  createCustomerSyncTestClient,
  getCustomerSyncTestDatabaseConfig,
} from "./helpers/customerSyncTestDatabase";

test("MySQL serializes recovery and sync and preserves the fitting", {
  skip: process.env.DATABASE_URL_TEST ? false : "DATABASE_URL_TEST is required",
}, async () => {
  const config = getCustomerSyncTestDatabaseConfig();
  const db = createCustomerSyncTestClient(config);
  await assertCustomerSyncTestDatabaseIdentity(db, config);
  const originalFetch = globalThis.fetch;
  const originalLocation = process.env.GHL_SWINGLOCKER_LOCATION_ID;
  const originalToken = process.env.GHL_SWINGLOCKER_PRIVATE_TOKEN;
  process.env.GHL_SWINGLOCKER_LOCATION_ID = "test-location";
  process.env.GHL_SWINGLOCKER_PRIVATE_TOKEN = "test-token";
  const unique = randomUUID();
  let clientId: number | undefined;
  let sessionId: number | undefined;
  let otherSessionId: number | undefined;
  let batchId: number | undefined;
  let staffId: number | undefined;
  let clubId: number | undefined;
  try {
    const contactId = `c-${unique}`;
    const email = `fitting-${unique}@example.test`;
    const client = await db.golfClient.create({
      data: { firstName: "Ann", email, ghlContactId: contactId },
    });
    clientId = client.id;
    const staff = await db.staffUser.create({ data: { email: `staff-${unique}@example.test` } });
    staffId = staff.id;
    const session = await db.demoSession.create({
      data: {
        clientId, lockerToken: unique, status: "finalized", ghlSyncStatus: "failed",
        ghlSyncError: "[action-required] This customer already has a saved GHL contact. Review the customer decision instead of creating or reusing another contact.",
      },
    });
    sessionId = session.id;
    const otherSession = await db.demoSession.create({
      data: { clientId, lockerToken: `${unique}-other`, status: "finalized" },
    });
    otherSessionId = otherSession.id;
    const club = await db.demoClubTest.create({
      data: { demoSessionId: session.id, clubType: "7i", brand: "Test" },
    });
    clubId = club.id;
    const snapshot: GhlReviewSnapshot = {
      v: 1, discoverySignature: "a".repeat(64), incomplete: false,
      candidates: [], acknowledgedDiscrepancies: [], acknowledgedCandidateIds: [],
    };
    const identity = resolveBatchLocalIdentity({
      customerResolution: "existing", selectedGolfClientId: client.id,
      proposedFirstName: null, proposedLastName: null, proposedEmail: null, proposedPhone: null,
    }, client)!;
    const batch = await db.importBatch.create({
      data: {
        originalFileName: "test.csv", parserMode: "trackman-result", status: "finalized",
        demoSessionId: session.id, customerResolution: "existing", selectedGolfClientId: client.id,
        opportunityResolution: "new", ghlContactDecision: "new",
        ghlContactApprovalSignature: computeApprovalSignature({ identity, decision: "new", approvedContactId: null, snapshot }),
        ghlContactReviewSnapshot: { ...snapshot, candidates: [] },
      },
    });
    batchId = batch.id;
    globalThis.fetch = async (input, init) => {
      assert.equal(init?.method, "GET");
      const contact = { id: contactId, locationId: "test-location", firstName: "Ann", email };
      return new Response(JSON.stringify(new URL(String(input)).pathname.endsWith("/lookup")
        ? { contacts: [contact] } : { contact }), { status: 200 });
    };
    const review = await inspectFittingContactRecovery(db, batch.id);
    assert.ok(review);
    const claims = await Promise.all([claimFittingSync(db, session.id), claimFittingSync(db, session.id)]);
    const claim = claims.find((value) => value !== null);
    assert.ok(claim);
    assert.equal(claims.filter(Boolean).length, 1);
    assert.equal(await claimFittingSync(db, otherSession.id), null);
    assert.equal(await confirmFittingContactRecovery(db, batch.id, staff.id, claim, review.fingerprint), true);
    await releaseFittingSync(db, session.id, claim);
    const parallel = await Promise.all([
      claimFittingSync(db, session.id),
      claimFittingSync(db, otherSession.id),
    ]);
    assert.equal(parallel.filter(Boolean).length, 1);
    if (parallel[0]) await releaseFittingSync(db, session.id, parallel[0]);
    if (parallel[1]) await releaseFittingSync(db, otherSession.id, parallel[1]);
    const savedBatch = await db.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    const savedSession = await db.demoSession.findUniqueOrThrow({ where: { id: session.id } });
    assert.equal(savedBatch.approvedGhlContactId, contactId);
    assert.equal(savedBatch.opportunityResolution, "new");
    assert.equal(savedSession.clientId, client.id);
    assert.equal(savedSession.ghlOpportunityId, null);
    assert.equal(savedSession.status, "finalized");
    const savedClub = await db.demoClubTest.findUniqueOrThrow({ where: { id: club.id } });
    assert.equal(savedClub.brand, "Test");
    assert.equal(savedClub.demoSessionId, session.id);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocation === undefined) delete process.env.GHL_SWINGLOCKER_LOCATION_ID;
    else process.env.GHL_SWINGLOCKER_LOCATION_ID = originalLocation;
    if (originalToken === undefined) delete process.env.GHL_SWINGLOCKER_PRIVATE_TOKEN;
    else process.env.GHL_SWINGLOCKER_PRIVATE_TOKEN = originalToken;
    if (batchId) await db.importBatch.delete({ where: { id: batchId } });
    if (clubId) await db.demoClubTest.delete({ where: { id: clubId } });
    if (sessionId) await db.demoSession.delete({ where: { id: sessionId } });
    if (otherSessionId) await db.demoSession.delete({ where: { id: otherSessionId } });
    if (clientId) await db.golfClient.delete({ where: { id: clientId } });
    if (staffId) await db.staffUser.delete({ where: { id: staffId } });
    await db.$disconnect();
  }
});
