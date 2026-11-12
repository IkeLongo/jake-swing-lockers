import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Prisma, type PrismaClient } from "../app/generated/prisma/client";
import { claimFittingSync, releaseFittingSync } from "../lib/ghl/fittingSyncClaim";
import { confirmFittingContactRecovery, inspectFittingContactRecovery } from "../lib/ghl/recoverFittingContact";
import { computeApprovalSignature, resolveBatchLocalIdentity, type GhlReviewSnapshot } from "../lib/imports/ghl-contact-approval";
import { getCurrentGhlDecision } from "../lib/imports/ghl-approval-gate";
import { syncStagedFittingToGHL, type StagedSyncDeps } from "../lib/ghl/syncStagedFitting";

const originalFetch = globalThis.fetch;
const originalLocation = process.env.GHL_SWINGLOCKER_LOCATION_ID;
const originalToken = process.env.GHL_SWINGLOCKER_PRIVATE_TOKEN;
process.env.GHL_SWINGLOCKER_LOCATION_ID = "test-location";
process.env.GHL_SWINGLOCKER_PRIVATE_TOKEN = "test-token";
after(() => {
  globalThis.fetch = originalFetch;
  if (originalLocation === undefined) delete process.env.GHL_SWINGLOCKER_LOCATION_ID;
  else process.env.GHL_SWINGLOCKER_LOCATION_ID = originalLocation;
  if (originalToken === undefined) delete process.env.GHL_SWINGLOCKER_PRIVATE_TOKEN;
  else process.env.GHL_SWINGLOCKER_PRIVATE_TOKEN = originalToken;
});

function harness() {
  const client = {
    id: 3, firstName: "Ann", lastName: "Lee", email: "ann@example.test", phone: null,
    ghlContactId: "current", ghlContactCreationState: null,
    syncState: null as null | {
      creationAttemptId: string | null; creationAttemptVersion: number | null;
      creationAttemptStatus: string | null; creationAttemptedAt: Date | null;
    },
  };
  const session = {
    id: 7, clientId: client.id, status: "finalized", ghlSyncStatus: "failed",
    ghlSyncError: "[action-required] This customer already has a saved GHL contact. Review the customer decision instead of creating or reusing another contact.",
    ghlSyncState: null as unknown,
    ghlOpportunityId: null as string | null, ghlLockerReadyTagAddedAt: null,
    client,
  };
  const batch = {
    id: 1, parserMode: "trackman-result", status: "finalized", demoSessionId: session.id,
    customerResolution: "existing", selectedGolfClientId: client.id,
    proposedFirstName: null, proposedLastName: null, proposedEmail: null, proposedPhone: null,
    opportunityResolution: "new", selectedGhlOpportunityId: null,
    ghlContactDecision: "new", approvedGhlContactId: null as string | null,
    ghlContactApprovalSignature: "", ghlContactApprovedAt: null as Date | null,
    ghlContactApprovedByStaffUserId: null as number | null,
    ghlContactReviewSnapshot: null as unknown,
    demoSession: session,
  };
  const snapshot: GhlReviewSnapshot = {
    v: 1, discoverySignature: "a".repeat(64), incomplete: false, candidates: [],
    acknowledgedDiscrepancies: [], acknowledgedCandidateIds: [],
  };
  batch.ghlContactReviewSnapshot = snapshot;
  batch.ghlContactApprovalSignature = computeApprovalSignature({
    identity: resolveBatchLocalIdentity(batch, client)!,
    decision: "new", approvedContactId: null, snapshot,
  });
  let owner = client.id;
  let activeStaff = true;
  let reads = 0;
  let writes = 0;
  let afterLookup: (() => void) | null = null;
  let lookupMode: "normal" | "competing" | "incomplete" | "missing" | "wrong-location" = "normal";
  globalThis.fetch = async (input, init) => {
    assert.equal(init?.method, "GET");
    reads++;
    const url = new URL(String(input));
    const contact = { id: "current", locationId: lookupMode === "wrong-location" ? "other-location" : "test-location", firstName: "Ann", lastName: "Lee", email: "ann@example.test", phone: null };
    const result = url.pathname.endsWith("/lookup")
      ? {
          contacts: lookupMode === "competing" ? [contact, { ...contact, id: "other" }] : [contact],
          ...(lookupMode === "incomplete" ? { nextCursor: "more" } : {}),
        }
      : { contact: lookupMode === "missing" ? null : contact };
    if (afterLookup) {
      const callback = afterLookup;
      afterLookup = null;
      callback();
    }
    return new Response(JSON.stringify(result), { status: 200 });
  };
  let previous = Promise.resolve();
  const fake = {
    async $transaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      let release!: () => void;
      const wait = previous;
      previous = new Promise<void>((resolve) => { release = resolve; });
      await wait;
      try { return await fn(fake as never); } finally { release(); }
    },
    async $queryRaw(strings: TemplateStringsArray) {
      if (strings.join("?").includes("SELECT id, ghlSyncState")) {
        return [{ id: session.id, ghlSyncState: structuredClone(session.ghlSyncState) }];
      }
      return [{ id: 7 }];
    },
    importBatch: {
      async findUnique() { return structuredClone(batch); },
      async update({ data }: { data: Partial<typeof batch> }) { writes++; Object.assign(batch, data); },
    },
    demoSession: {
      async findUnique() { return { clientId: session.clientId }; },
      async findUniqueOrThrow() { return { ghlSyncState: structuredClone(session.ghlSyncState) }; },
      async update({ data }: { data: Partial<typeof session> }) {
        writes++;
        Object.assign(session, data);
        if (data.ghlSyncState === Prisma.DbNull) session.ghlSyncState = null;
      },
    },
    golfClient: {
      async findMany() {
        return owner === client.id
          ? [{ id: client.id, firstName: client.firstName, lastName: client.lastName, ghlContactId: client.ghlContactId }]
          : [{ id: owner, firstName: "Other", lastName: null, ghlContactId: "current" }];
      },
      async findUnique() { return { id: owner }; },
    },
    staffUser: { async findUnique() { return { isActive: activeStaff }; } },
  };
  return {
    db: fake as unknown as PrismaClient, batch, session, client,
    setOwner: (id: number) => { owner = id; },
    setStaffActive: (active: boolean) => { activeStaff = active; },
    setLookupMode: (mode: typeof lookupMode) => { lookupMode = mode; },
    afterLookup: (callback: () => void) => { afterLookup = callback; },
    counts: () => ({ reads, writes }),
  };
}

test("staff approval replaces the outdated decision and CRM sync can retry", async () => {
  const h = harness();
  const review = await inspectFittingContactRecovery(h.db, 1);
  assert.ok(review);
  assert.equal(review.contact.id, "current");
  assert.equal(review.batch.ghlContactDecision, "new");
  const claim = await claimFittingSync(h.db, 7);
  assert.ok(claim);
  assert.equal(await confirmFittingContactRecovery(h.db, 1, 42, claim, review.fingerprint), true);
  await releaseFittingSync(h.db, 7, claim);
  assert.equal(h.batch.approvedGhlContactId, "current");
  assert.equal(h.batch.ghlContactApprovedByStaffUserId, 42);
  assert.equal(getCurrentGhlDecision(h.batch, h.client), "existing");
  assert.equal(h.session.clientId, 3);
  assert.equal(h.session.ghlOpportunityId, null);
  assert.equal(h.batch.opportunityResolution, "new");

  let usedContact = "";
  const deps: StagedSyncDeps = {
    async loadBatch() {
      return {
        ...h.batch,
        demoSession: {
          ...h.session, lockerToken: "token", demoDate: new Date(), salesRep: null,
          currentClub: null, clubTests: [], client: { ...h.client, syncState: null },
        },
      };
    },
    async verifyApprovedContact(id) { usedContact = id; },
    async resolveNewContact() { throw new Error("must not create a contact"); },
    async saveContactId() { throw new Error("must not relink the customer"); },
    async validateOpportunity() { return { valid: true }; },
    async createOpportunity() { return "opp"; },
    async ensureOpportunityId(_session, _batch, _contact, create) { return create(); },
    async updateContactCustomFields() {},
    async addTags() {},
    async markTagsAdded() {},
    async markSynced() {},
    async markFailed() { throw new Error("unexpected failure"); },
    now: () => new Date(),
    appBaseUrl: () => "https://example.test",
  };
  assert.equal((await syncStagedFittingToGHL(deps, 1)).ok, true);
  assert.equal(usedContact, "current");
});

test("contact changes or conflicting ownership reject confirmation without approval writes", async () => {
  for (const change of ["link", "profile", "owner", "creation", "staff"] as const) {
    const h = harness();
    const review = await inspectFittingContactRecovery(h.db, 1);
    assert.ok(review);
    const claim = await claimFittingSync(h.db, 7);
    assert.ok(claim);
    const before = h.counts().writes;
    if (change === "link") h.client.ghlContactId = "different";
    if (change === "profile") h.client.firstName = "Changed";
    if (change === "owner") h.setOwner(9);
    if (change === "creation") h.client.syncState = {
      creationAttemptId: "attempt", creationAttemptVersion: 1,
      creationAttemptStatus: "creating", creationAttemptedAt: new Date(),
    };
    if (change === "staff") h.setStaffActive(false);
    assert.equal(await confirmFittingContactRecovery(h.db, 1, 42, claim, review.fingerprint), false, change);
    assert.equal(h.counts().writes, before, change);
    await releaseFittingSync(h.db, 7, claim);
  }
});

test("association changes while GHL is being checked are fenced in the transaction", async () => {
  const h = harness();
  const review = await inspectFittingContactRecovery(h.db, 1);
  assert.ok(review);
  const claim = await claimFittingSync(h.db, 7);
  assert.ok(claim);
  h.afterLookup(() => { h.client.ghlContactId = "different"; });
  assert.equal(await confirmFittingContactRecovery(h.db, 1, 42, claim, review.fingerprint), false);
  assert.equal(h.batch.ghlContactDecision, "new");
  await releaseFittingSync(h.db, 7, claim);
});

test("a stale existing approval can be re-approved for the same verified contact", async () => {
  const h = harness();
  h.batch.ghlContactDecision = "existing";
  h.batch.approvedGhlContactId = "current";
  h.session.ghlSyncError = "[action-required] The GHL contact approval is stale. Review and approve it again before syncing.";
  const review = await inspectFittingContactRecovery(h.db, 1);
  assert.ok(review);
  const claim = await claimFittingSync(h.db, 7);
  assert.ok(claim);
  assert.equal(await confirmFittingContactRecovery(h.db, 1, 42, claim, review.fingerprint), true);
  await releaseFittingSync(h.db, 7, claim);
  assert.equal(getCurrentGhlDecision(h.batch, h.client), "existing");
});

test("a conflicting existing approval is changed without changing the selected opportunity", async () => {
  const h = harness();
  h.batch.ghlContactDecision = "existing";
  h.batch.approvedGhlContactId = "old";
  h.batch.opportunityResolution = "existing";
  Object.assign(h.batch, { selectedGhlOpportunityId: "opp-old" });
  h.session.ghlOpportunityId = "opp-old";
  h.session.ghlSyncError = "[action-required] The local customer is linked to a different GHL contact than the one approved for this fitting.";
  const snapshot = h.batch.ghlContactReviewSnapshot as GhlReviewSnapshot;
  h.batch.ghlContactApprovalSignature = computeApprovalSignature({
    identity: resolveBatchLocalIdentity(h.batch, h.client)!,
    decision: "existing", approvedContactId: "old", snapshot,
  });
  const review = await inspectFittingContactRecovery(h.db, 1);
  assert.ok(review);
  assert.equal(review.batch.approvedGhlContactId, "old");
  const claim = await claimFittingSync(h.db, 7);
  assert.ok(claim);
  assert.equal(await confirmFittingContactRecovery(h.db, 1, 42, claim, review.fingerprint), true);
  await releaseFittingSync(h.db, 7, claim);
  assert.equal(h.batch.approvedGhlContactId, "current");
  assert.equal(h.batch.selectedGhlOpportunityId, "opp-old");
  assert.equal(h.session.ghlOpportunityId, "opp-old");
});

test("sync and recovery claims serialize and interrupted claims do not expire", async () => {
  const h = harness();
  const [first, second] = await Promise.all([claimFittingSync(h.db, 7), claimFittingSync(h.db, 7)]);
  assert.ok(first);
  assert.equal(second, null);
  assert.equal(await inspectFittingContactRecovery(h.db, 1), null);
  await assert.rejects(releaseFittingSync(h.db, 7, "wrong-token"));
  assert.equal(await claimFittingSync(h.db, 7), null);
  await releaseFittingSync(h.db, 7, first);
  assert.ok(await claimFittingSync(h.db, 7));
});

test("unresolved creation markers block a new fitting claim", async () => {
  for (const marker of [
    { contact: { status: "creating" } },
    { opportunity: { status: "creating" } },
    { contact: { status: "unknown" } },
  ]) {
    const h = harness();
    h.session.ghlSyncState = { version: 1, ...marker };
    assert.equal(await claimFittingSync(h.db, 7), null);
    assert.equal(h.counts().writes, 0);
  }
});

test("a claim is retained if an unresolved marker appears while held", async () => {
  const h = harness();
  const claim = await claimFittingSync(h.db, 7);
  assert.ok(claim);
  h.session.ghlSyncState = {
    ...(h.session.ghlSyncState as object), opportunity: { status: "creating" },
  };
  assert.equal(await releaseFittingSync(h.db, 7, claim), false);
  assert.equal(await claimFittingSync(h.db, 7), null);
});

test("missing, competing, incomplete or wrong-location contacts cannot be approved", async () => {
  for (const mode of ["missing", "competing", "incomplete", "wrong-location"] as const) {
    const h = harness();
    h.setLookupMode(mode);
    assert.equal(await inspectFittingContactRecovery(h.db, 1), null, mode);
    assert.equal(h.counts().writes, 0, mode);
  }
});

test("unrelated failures and partially synced fittings cannot use recovery", async () => {
  for (const change of ["error", "opportunity", "tags", "creation"] as const) {
    const h = harness();
    if (change === "error") h.session.ghlSyncError = "[action-required] The attached GHL opportunity no longer exists.";
    if (change === "opportunity") h.session.ghlOpportunityId = "existing-created";
    if (change === "tags") Object.assign(h.session, { ghlLockerReadyTagAddedAt: new Date() });
    if (change === "creation") h.session.ghlSyncState = { version: 1, opportunity: { status: "creating" } };
    assert.equal(await inspectFittingContactRecovery(h.db, 1), null, change);
    assert.equal(h.counts().reads, 0, change);
  }
});
