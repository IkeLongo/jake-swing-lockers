import assert from "node:assert/strict";
import { test } from "node:test";
import {
  syncStagedFittingToGHL,
  CreationNeedsReconciliationError,
  type StagedSyncBatch,
  type StagedSyncDeps,
  type SyncOpportunityValidation,
} from "../lib/ghl/syncStagedFitting";
import { ContactNeedsReviewError } from "../lib/ghl/resolveStagedContact";
import { GhlApiError } from "../lib/ghl/client";
import {
  computeApprovalSignature,
  resolveBatchLocalIdentity,
  type GhlReviewSnapshot,
} from "../lib/imports/ghl-contact-approval";
import {
  buildGolfDemoCustomFields,
  buildGolfDemoSummaries,
  golfDemoOpportunityName,
  type SyncSessionInfo,
} from "../lib/ghl/golfDemoSyncContent";
import { upsertGolfDemoOpportunity } from "../lib/ghl/opportunities";

// Field IDs are env-driven; configure one so the custom-field step runs.
process.env.GHL_SWINGLOCKER_CF_SWING_LOCKER_URL = "cf-url";

function makeBatch(over: Partial<StagedSyncBatch> = {}, sessionOver: Record<string, unknown> = {}): StagedSyncBatch {
  const batch: StagedSyncBatch = {
    id: 1,
    parserMode: "trackman-result",
    status: "finalized",
    customerResolution: "new",
    selectedGolfClientId: null,
    proposedFirstName: "Ann",
    proposedLastName: "Lee",
    proposedEmail: "a@b.co",
    proposedPhone: null,
    ghlContactDecision: null,
    approvedGhlContactId: null,
    ghlContactApprovalSignature: null,
    ghlContactReviewSnapshot: null,
    opportunityResolution: "new",
    selectedGhlOpportunityId: null,
    demoSession: {
      id: 7,
      status: "finalized",
      lockerToken: "tok",
      demoDate: new Date("2026-05-08T12:00:00Z"),
      salesRep: "Rep",
      currentClub: null,
      ghlOpportunityId: null,
      ghlSyncStatus: null,
      ghlSyncState: null,
      ghlLockerReadyTagAddedAt: null,
      clubTests: [
        { clubRole: "demo", clubType: "7i", brand: "Ping", model: "G430", isRecommended: false, estimatedPrice: { toNumber: () => 1000 } },
      ],
      client: { id: 3, firstName: "Ann", lastName: "Lee", email: "a@b.co", phone: null, ghlContactId: null },
      ...sessionOver,
    },
    ...over,
  } as StagedSyncBatch;
  return "ghlContactDecision" in over || !batch.demoSession
    ? batch
    : approveBatch(batch, "new", null);
}

function approveBatch(
  batch: StagedSyncBatch,
  decision: "existing" | "new",
  contactId: string | null,
): StagedSyncBatch {
  const client = batch.demoSession!.client;
  const identity = resolveBatchLocalIdentity(batch, client);
  assert.ok(identity);
  const snapshot: GhlReviewSnapshot = {
    v: 1,
    discoverySignature: "a".repeat(64),
    incomplete: false,
    candidates: [],
    acknowledgedDiscrepancies: [],
    acknowledgedCandidateIds: [],
  };
  return {
    ...batch,
    ghlContactDecision: decision,
    approvedGhlContactId: contactId,
    ghlContactApprovalSignature: computeApprovalSignature({
      identity,
      decision,
      approvedContactId: contactId,
      snapshot,
    }),
    ghlContactReviewSnapshot: snapshot,
  };
}

function cloneBatch(b: StagedSyncBatch): StagedSyncBatch {
  const s = b.demoSession;
  return {
    ...b,
    demoSession: s && {
      ...s,
      client: { ...s.client },
      clubTests: s.clubTests.map((c) => ({ ...c })),
    },
  };
}

interface Calls {
  contactCreates: number;
  createOpportunity: number;
  validate: number;
  fields: number;
  tags: number;
  order: string[];
  failedRetryable: boolean[];
  verifiedContacts: string[];
  newContactResolutions: number;
  validatedContactIds: string[];
  newContactInputs: { firstName: string | null; lastName: string | null; email: string | null; phone: string | null }[];
}

function harness(batch: StagedSyncBatch) {
  const calls: Calls = {
    contactCreates: 0,
    createOpportunity: 0,
    validate: 0,
    fields: 0,
    tags: 0,
    order: [],
    failedRetryable: [],
    verifiedContacts: [],
    newContactResolutions: 0,
    validatedContactIds: [],
    newContactInputs: [],
  };
  const opts = {
    validation: { valid: true } as SyncOpportunityValidation | "throw",
    failAt: null as null | "fields" | "tags" | "create-rejected" | "create-ambiguous" | "contact",
  };
  const db = { batch, localWrites: 0 };
  const session = () => db.batch.demoSession!;
  let opportunityPending = false;
  let resolvedNewContact: string | null = null;

  const deps: StagedSyncDeps = {
    loadBatch: async () => cloneBatch(db.batch),
    verifyApprovedContact: async (id) => {
      calls.verifiedContacts.push(id);
      if (opts.failAt === "contact") {
        throw new ContactNeedsReviewError("wrong_location", "Contact mismatch.");
      }
    },
    resolveNewContact: async (_input, args) => {
      calls.newContactResolutions++;
      calls.newContactInputs.push(_input);
      if (opts.failAt === "contact") throw new Error("contact down");
      if (resolvedNewContact) {
        if (args.savedGhlContactId !== null) {
          assert.equal(args.savedGhlContactId, resolvedNewContact);
        }
        return { id: resolvedNewContact };
      }
      if (args.savedGhlContactId) {
        throw new ContactNeedsReviewError("identity_conflict", "Old link not reusable.");
      }
      calls.contactCreates++;
      resolvedNewContact = "contact-new";
      session().client.ghlContactId = resolvedNewContact;
      calls.order.push("saveContact");
      return { id: resolvedNewContact };
    },
    saveContactId: async (_c, id) => {
      calls.order.push("saveContact");
      session().client.ghlContactId = id;
    },
    validateOpportunity: async (_id, contactId) => {
      calls.validate++;
      calls.validatedContactIds.push(contactId);
      if (opts.validation === "throw") throw new Error("GHL down");
      return opts.validation;
    },
    createOpportunity: async () => {
      calls.createOpportunity++;
      if (opts.failAt === "create-rejected") {
        throw new GhlApiError(400, "Bad Request", "Invalid opportunity.");
      }
      if (opts.failAt === "create-ambiguous") {
        throw new Error("response lost after remote create");
      }
      return `opp-${calls.createOpportunity}`;
    },
    ensureOpportunityId: (_id, _batchId, _contactId, create) => {
      const existingId = session().ghlOpportunityId;
      if (existingId) return Promise.resolve(existingId);
      if (opportunityPending) {
        return Promise.reject(
          new CreationNeedsReconciliationError("Opportunity creation requires reconciliation."),
        );
      }
      opportunityPending = true;
      return (async () => {
        let created: string;
        try {
          created = await create();
        } catch (error) {
          if (error instanceof GhlApiError && [400, 401, 403, 404, 422, 429].includes(error.status)) {
            opportunityPending = false;
            throw error;
          }
          throw new CreationNeedsReconciliationError("Opportunity creation requires reconciliation.");
        }
        calls.order.push("saveOpp");
        session().ghlOpportunityId = created;
        opportunityPending = false;
        return created;
      })();
    },
    updateContactCustomFields: async () => {
      calls.fields++;
      calls.order.push("fields");
      if (opts.failAt === "fields") throw new Error("fields failed");
    },
    addTags: async () => {
      calls.tags++;
      if (opts.failAt === "tags") throw new Error("tags failed");
    },
    markTagsAdded: async () => {
      calls.order.push("tagMarker");
      session().ghlLockerReadyTagAddedAt = new Date();
    },
    markSynced: async () => {
      session().ghlSyncStatus = "synced";
    },
    markFailed: async (args) => {
      calls.failedRetryable.push(args.retryable);
      session().ghlSyncStatus = "failed";
    },
    now: () => new Date("2030-01-01T00:00:00Z"),
    appBaseUrl: () => "https://app.test",
  };
  return { deps, calls, opts, db };
}

test("new opportunity + customer without GHL contact", async () => {
  const h = harness(makeBatch());
  const r = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.ghlContactId, "contact-new");
  assert.equal(r.ghlOpportunityId, "opp-1");
  assert.equal(h.calls.contactCreates, 1);
  assert.deepEqual(h.calls.newContactInputs, [{
    firstName: "Ann",
    lastName: "Lee",
    email: "a@b.co",
    phone: null,
  }]);
  assert.equal(h.calls.createOpportunity, 1);
  assert.equal(h.db.batch.demoSession!.client.ghlContactId, "contact-new");
  assert.equal(h.db.batch.demoSession!.ghlSyncStatus, "synced");
});

test("existing customer new-contact approval creates from persisted customer identity, not batch proposals", async () => {
  const b = approveBatch(
    makeBatch(
      {
        customerResolution: "existing",
        selectedGolfClientId: 3,
        proposedFirstName: "Wrong",
        proposedLastName: "Person",
        proposedEmail: "wrong@example.net",
        proposedPhone: "+14155550199",
      },
      {
        client: {
          id: 3,
          firstName: "Ann",
          lastName: "Lee",
          email: "ann@example.com",
          phone: "+12105550100",
          ghlContactId: null,
        },
      },
    ),
    "new",
    null,
  );
  const h = harness(b);
  const result = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(result.ok, true);
  assert.deepEqual(h.calls.newContactInputs, [{
    firstName: "Ann",
    lastName: "Lee",
    email: "ann@example.com",
    phone: "+12105550100",
  }]);
});

test("existing ghlContactId is reused", async () => {
  const b = approveBatch(
    makeBatch(
      { customerResolution: "existing", selectedGolfClientId: 3 },
      { client: { id: 3, firstName: "Ann", lastName: "Lee", email: "a@b.co", phone: null, ghlContactId: "contact-old" } },
    ),
    "existing",
    "contact-old",
  );
  const h = harness(b);
  const r = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(r.ok && r.ghlContactId, "contact-old");
  assert.equal(h.calls.contactCreates, 0);
  assert.deepEqual(h.calls.verifiedContacts, ["contact-old"]);
});

test("existing approved contact never falls back to a different saved GHL contact", async () => {
  const b = approveBatch(
    makeBatch(
      { customerResolution: "existing", selectedGolfClientId: 3 },
      {
        client: { id: 3, firstName: "Ann", lastName: "Lee", email: "a@b.co", phone: null, ghlContactId: "contact-old" },
      },
    ),
    "existing",
    "contact-approved",
  );
  const h = harness(b);
  const r = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, "contact-needs-review");
  assert.deepEqual(h.calls.verifiedContacts, []);
  assert.equal(h.calls.createOpportunity, 0);
  assert.equal(h.db.batch.demoSession!.client.ghlContactId, "contact-old");
});

test("missing and stale GHL approvals stop before any CRM work", async () => {
  const missing = makeBatch({ ghlContactDecision: null });
  const stale = makeBatch();
  stale.ghlContactApprovalSignature = "stale";
  for (const batch of [missing, stale]) {
    const h = harness(batch);
    const r = await syncStagedFittingToGHL(h.deps, 1);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.code, "contact-needs-review");
    assert.equal(h.calls.contactCreates + h.calls.createOpportunity, 0);
  }
});

test("new-contact approval does not reuse a pre-existing customer contact link", async () => {
  const b = makeBatch({}, {
    client: { id: 3, firstName: "Ann", lastName: "Lee", email: "a@b.co", phone: null, ghlContactId: "contact-old" },
  });
  const h = harness(b);
  const r = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, "contact-needs-review");
  assert.equal(h.calls.contactCreates, 0);
  assert.equal(h.calls.createOpportunity, 0);
});

test("new-contact approval cannot sync to an existing opportunity", async () => {
  const b = makeBatch(
    {
      customerResolution: "existing",
      selectedGolfClientId: 3,
      opportunityResolution: "existing",
      selectedGhlOpportunityId: "opp-x",
    },
    {
      ghlOpportunityId: "opp-x",
      client: { id: 3, firstName: "Ann", lastName: "Lee", email: "a@b.co", phone: null, ghlContactId: null },
    },
  );
  const h = harness(b);
  const r = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, "contact-needs-review");
  assert.equal(h.calls.verifiedContacts.length + h.calls.contactCreates, 0);
  assert.equal(h.calls.validate + h.calls.createOpportunity, 0);
});

test("contact and opportunity IDs are persisted before later steps", async () => {
  const h = harness(makeBatch());
  await syncStagedFittingToGHL(h.deps, 1);
  assert.deepEqual(h.calls.order, ["saveContact", "saveOpp", "fields", "tagMarker"]);
});

test("failure after opportunity creation keeps the ID; retry reuses it", async () => {
  const h = harness(makeBatch());
  h.opts.failAt = "fields";
  const first = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(first.ok, false);
  assert.equal(first.ok === false && first.status === "failed" && first.retryable, true);
  assert.equal(h.db.batch.demoSession!.ghlOpportunityId, "opp-1");
  assert.equal(h.db.batch.demoSession!.ghlSyncStatus, "failed");

  h.opts.failAt = null;
  const second = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(second.ok && second.ghlOpportunityId, "opp-1");
  assert.equal(h.calls.createOpportunity, 1);
  assert.equal(h.calls.contactCreates, 1);
});

test("a definitive opportunity rejection can safely retry", async () => {
  const h = harness(makeBatch());
  h.opts.failAt = "create-rejected";
  const r = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(r.ok === false && r.status, "failed");
  assert.equal(h.db.batch.demoSession!.ghlOpportunityId, null);
  h.opts.failAt = null;
  const again = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(again.ok, true);
});

test("an ambiguous opportunity response blocks retry until reconciliation", async () => {
  const h = harness(makeBatch());
  h.opts.failAt = "create-ambiguous";
  const first = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(first.ok, false);
  assert.equal(first.ok === false && first.code, "creation-needs-reconciliation");
  if (first.ok || first.status !== "failed") assert.fail("expected a failed reconciliation result");
  assert.equal(first.retryable, false);
  assert.equal(h.db.batch.demoSession!.ghlOpportunityId, null);

  h.opts.failAt = null;
  const retry = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(retry.ok, false);
  assert.equal(retry.ok === false && retry.code, "creation-needs-reconciliation");
  assert.equal(h.calls.createOpportunity, 1);
});

test("existing opportunity: validated read-only, never created or updated", async () => {
  const b = approveBatch(
    makeBatch(
      {
        customerResolution: "existing",
        selectedGolfClientId: 3,
        opportunityResolution: "existing",
        selectedGhlOpportunityId: "opp-x",
      },
      {
        ghlOpportunityId: "opp-x",
        client: { id: 3, firstName: "Ann", lastName: "Lee", email: "a@b.co", phone: null, ghlContactId: "contact-approved" },
      },
    ),
    "existing",
    "contact-approved",
  );
  const h = harness(b);
  const r = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(r.ok && r.ghlOpportunityId, "opp-x");
  assert.deepEqual(h.calls.verifiedContacts, ["contact-approved"]);
  assert.equal(h.calls.validate, 1);
  assert.deepEqual(h.calls.validatedContactIds, ["contact-approved"]);
  assert.equal(h.calls.createOpportunity, 0);
  assert.equal(h.calls.fields, 1);
});

test("existing opportunity validation failures are recorded, not retryable", async () => {
  for (const reason of ["not_found", "not_relevant"] as const) {
    const b = approveBatch(
      makeBatch(
        {
          customerResolution: "existing",
          selectedGolfClientId: 3,
          opportunityResolution: "existing",
          selectedGhlOpportunityId: "opp-x",
        },
        {
          ghlOpportunityId: "opp-x",
          client: { id: 3, firstName: "Ann", lastName: "Lee", email: "a@b.co", phone: null, ghlContactId: "contact-old" },
        },
      ),
      "existing",
      "contact-old",
    );
    const h = harness(b);
    h.opts.validation = { valid: false, reason };
    const r = await syncStagedFittingToGHL(h.deps, 1);
    assert.equal(r.ok === false && r.status === "failed" && r.retryable, false);
    assert.equal(h.db.batch.demoSession!.ghlSyncStatus, "failed");
    assert.equal(h.calls.tags, 0);
  }
});

test("existing opportunity owned by another GHL contact is rejected", async () => {
  const b = approveBatch(
    makeBatch(
      {
        customerResolution: "existing",
        selectedGolfClientId: 3,
        opportunityResolution: "existing",
        selectedGhlOpportunityId: "opp-x",
      },
      {
        ghlOpportunityId: "opp-x",
        client: { id: 3, firstName: "Ann", lastName: "Lee", email: "a@b.co", phone: null, ghlContactId: "contact-approved" },
      },
    ),
    "existing",
    "contact-approved",
  );
  const h = harness(b);
  h.opts.validation = { valid: false, reason: "not_relevant" };
  const r = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(r.ok, false);
  assert.deepEqual(h.calls.validatedContactIds, ["contact-approved"]);
  assert.equal(h.calls.createOpportunity, 0);
  assert.equal(h.db.batch.demoSession!.ghlOpportunityId, "opp-x");
});

test("existing opportunity GHL outage is retryable", async () => {
  const b = approveBatch(
    makeBatch(
      {
        customerResolution: "existing",
        selectedGolfClientId: 3,
        opportunityResolution: "existing",
        selectedGhlOpportunityId: "opp-x",
      },
      {
        ghlOpportunityId: "opp-x",
        client: { id: 3, firstName: "Ann", lastName: "Lee", email: "a@b.co", phone: null, ghlContactId: "contact-old" },
      },
    ),
    "existing",
    "contact-old",
  );
  const h = harness(b);
  h.opts.validation = "throw";
  const r = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(r.ok === false && r.status === "failed" && r.retryable, true);
});

test("tags are not re-added after success; already-synced is a no-op", async () => {
  const h = harness(makeBatch());
  await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(h.calls.tags, 1);
  const again = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(again.ok && again.alreadySynced, true);
  assert.equal(h.calls.tags, 1);
  assert.equal(h.calls.fields, 1);
  assert.equal(h.calls.createOpportunity, 1);
});

test("tag failure leaves no marker; retry adds tags once without a new opportunity", async () => {
  const h = harness(makeBatch());
  h.opts.failAt = "tags";
  await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(h.db.batch.demoSession!.ghlLockerReadyTagAddedAt, null);
  h.opts.failAt = null;
  const r = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(r.ok, true);
  assert.equal(h.calls.createOpportunity, 1);
  assert.equal(h.calls.tags, 2);
});

test("tags already applied are not re-added when a later step is retried", async () => {
  const h = harness(makeBatch({}, { ghlLockerReadyTagAddedAt: new Date(), ghlSyncStatus: "failed", ghlOpportunityId: "opp-9" }));
  const r = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(r.ok && r.ghlOpportunityId, "opp-9");
  assert.equal(h.calls.tags, 0);
  assert.equal(h.calls.createOpportunity, 0);
});

test("already-synced legacy linked sessions remain a no-op without new approval fields", async () => {
  const b = makeBatch(
    {
      ghlContactDecision: null,
      approvedGhlContactId: null,
      ghlContactApprovalSignature: null,
      ghlContactReviewSnapshot: null,
    },
    {
      ghlSyncStatus: "synced",
      ghlOpportunityId: "opp-legacy",
      ghlLockerReadyTagAddedAt: new Date(),
      client: { id: 3, firstName: "Ann", lastName: "Lee", email: "a@b.co", phone: null, ghlContactId: "contact-legacy" },
    },
  );
  const h = harness(b);
  const r = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(r.ok && r.alreadySynced, true);
  assert.equal(h.calls.verifiedContacts.length + h.calls.createOpportunity, 0);
});

test("a contact needing review fails the sync non-retryably without touching the fitting", async () => {
  const h = harness(makeBatch());
  h.deps.resolveNewContact = async () => {
    throw new ContactNeedsReviewError("multiple_matches", "Multiple GHL contacts match.");
  };
  const r = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(r.ok, false);
  if (r.ok || r.status !== "failed") return assert.fail("expected failed");
  assert.equal(r.retryable, false);
  assert.equal(r.code, "contact-needs-review");
  assert.deepEqual(h.calls.failedRetryable, [false]);
  assert.equal(h.calls.createOpportunity, 0);
  assert.equal(h.db.batch.demoSession!.client.ghlContactId, null);
  assert.equal(h.db.batch.demoSession!.status, "finalized");
  assert.equal(h.db.batch.demoSession!.ghlSyncStatus, "failed");
});

test("preconditions are rejected", async () => {
  const cases: [StagedSyncBatch, string][] = [
    [makeBatch({ status: "reviewing" }), "not_finalized"],
    [makeBatch({ demoSession: null }), "no_session"],
    [makeBatch({ parserMode: "other" }), "not_eligible"],
    [makeBatch({ opportunityResolution: null }), "invalid_opportunity_state"],
    [makeBatch({ opportunityResolution: "new", selectedGhlOpportunityId: "opp-x" }), "invalid_opportunity_state"],
    [makeBatch({ opportunityResolution: "existing", selectedGhlOpportunityId: "opp-x" }), "invalid_opportunity_state"],
  ];
  for (const [batch, code] of cases) {
    const h = harness(batch);
    const r = await syncStagedFittingToGHL(h.deps, 1);
    assert.equal(r.ok === false && r.status === "rejected" && r.code, code);
    assert.equal(h.calls.contactCreates + h.calls.createOpportunity, 0);
  }
  const h = harness(makeBatch());
  h.deps.loadBatch = async () => null;
  const r = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(r.ok === false && r.status === "rejected" && r.httpStatus, 404);
});

test("simultaneous new-opportunity syncs create one opportunity", async () => {
  const h = harness(makeBatch());
  const results = await Promise.all([
    syncStagedFittingToGHL(h.deps, 1),
    syncStagedFittingToGHL(h.deps, 1),
    syncStagedFittingToGHL(h.deps, 1),
  ]);
  assert.ok(results.every((r) => r.ok || r.code === "creation-needs-reconciliation"));
  assert.equal(h.calls.createOpportunity, 1);
  assert.equal(h.db.batch.demoSession!.ghlOpportunityId, "opp-1");
});

test("CRM failure leaves local fitting data untouched", async () => {
  const b = makeBatch();
  const before = cloneBatch(b).demoSession!;
  const h = harness(b);
  h.opts.failAt = "contact";
  const r = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(r.ok, false);
  const after = h.db.batch.demoSession!;
  assert.equal(h.db.batch.status, "finalized");
  assert.equal(after.status, "finalized");
  assert.deepEqual(after.clubTests, before.clubTests);
  assert.equal(after.ghlOpportunityId, null);
});

// ── Legacy preservation ─────────────────────────────────────────────────────

const session: SyncSessionInfo = {
  id: 7,
  demoDate: new Date("2026-05-08T12:00:00Z"),
  salesRep: "Rep",
  currentClub: "Old 7i",
  clubTests: [
    { clubRole: "demo", clubType: "7i", brand: "Ping", model: "G430", isRecommended: true, estimatedPrice: { toNumber: () => 199.999 } },
    { clubRole: "demo", clubType: "8i", brand: null, model: null, isRecommended: false, estimatedPrice: { toNumber: () => 100 } },
    { clubRole: "current", clubType: "7i", brand: null, model: null, isRecommended: false, estimatedPrice: null },
  ],
};

test("shared builders reproduce the legacy summary/field output", () => {
  const s = buildGolfDemoSummaries(session);
  assert.deepEqual(s, {
    recommendedClubSummary: "Ping G430",
    currentClubSummary: "7i",
    demoClubCount: 2,
    monetaryValue: 300,
  });
  const fields = buildGolfDemoCustomFields(session, s, "https://x/l", "T", {
    GHL_SWINGLOCKER_CF_SWING_LOCKER_URL: "f1",
    GHL_SWINGLOCKER_CF_LATEST_DEMO_DATE: "f2",
    GHL_SWINGLOCKER_CF_DEMO_FOLLOWUP_STATUS: "f3",
    GHL_SWINGLOCKER_CF_LAST_DEMO_SUBMITTED_AT: "f4",
  });
  assert.deepEqual(fields, [
    { id: "f1", value: "https://x/l" },
    { id: "f2", value: "2026-05-08" },
    { id: "f3", value: "pending" },
    { id: "f4", value: "T" },
  ]);
  assert.equal(golfDemoOpportunityName({ firstName: "Ann", lastName: null }), "Ann - Golf Demo");
  assert.equal(golfDemoOpportunityName({ firstName: null, lastName: null }), "- Golf Demo");
});

test("legacy upsertGolfDemoOpportunity still updates an existing ID and creates otherwise", async () => {
  Object.assign(process.env, {
    GHL_SWINGLOCKER_PRIVATE_TOKEN: "t",
    GHL_SWINGLOCKER_LOCATION_ID: "loc",
    GHL_SWINGLOCKER_PIPELINE_ID: "pipe",
    GHL_SWINGLOCKER_STAGE_DEMO_SUBMITTED_ID: "stage",
  });
  const original = globalThis.fetch;
  const requests: { url: string; method: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requests.push({ url, method: init?.method ?? "GET", body: JSON.parse((init?.body as string) ?? "{}") });
    return new Response(JSON.stringify({ opportunity: { id: "new-1" } }), { status: 200 });
  }) as typeof fetch;
  try {
    const id = await upsertGolfDemoOpportunity({ name: "N", contactId: "c", monetaryValue: 5 }, "opp-1");
    assert.equal(id, "opp-1");
    assert.equal(requests[0]!.method, "PUT");
    assert.deepEqual(requests[0]!.body, { name: "N", pipelineStageId: "stage", monetaryValue: 5 });

    const created = await upsertGolfDemoOpportunity({ name: "N", contactId: "c" }, null);
    assert.equal(created, "new-1");
    assert.equal(requests[1]!.method, "POST");
  } finally {
    globalThis.fetch = original;
  }
});
