import test from "node:test";
import assert from "node:assert/strict";
import type {
  ContactDiscovery,
  DiscoveredContact,
} from "@/lib/ghl/discoverStagedContacts";
import { computeDiscoverySignature } from "@/lib/ghl/discoverySignature";
import {
  candidateApprovalBlock,
  canContinueWithApproval,
  getApprovalContinueHint,
  isStaleApprovalCode,
  missingCandidateAcks,
  missingDiscrepancyAcks,
  newContactBlock,
} from "@/lib/ghl/approvalUi";
import {
  buildLocalIdentity,
  evaluateApproval,
  type ApprovalOutcome,
} from "@/lib/imports/ghl-contact-approval";
import {
  getCurrentGhlDecision,
  type GhlGateBatch,
} from "@/lib/imports/ghl-approval-gate";
import { getOpportunityContactScope } from "@/lib/imports/opportunity-contact";
import {
  getOpportunityOptions,
  saveOpportunitySelection,
  type OpportunitySelectionBatch,
  type OpportunitySelectionDeps,
} from "@/lib/imports/opportunity-selection";
import type { GhlOpportunity } from "@/lib/ghl/opportunities";

const flags = {
  multipleMatches: false,
  identifierConflict: false,
  identityConflict: false,
  wrongLocation: false,
  linkedElsewhere: false,
  incomplete: false,
  savedLinkMissing: false,
  savedLinkMismatch: false,
};

const candidate = (over: Partial<DiscoveredContact> = {}): DiscoveredContact => ({
  id: "c-1",
  firstName: "Ann",
  lastName: "Lee",
  email: "ann@example.com",
  phone: "+12105550100",
  reasons: ["email", "phone"],
  discrepancies: [],
  wrongLocation: false,
  locationVerified: true,
  linkedClients: [],
  ...over,
});

const discovery = (
  candidates: DiscoveredContact[],
  over: Partial<ContactDiscovery> = {},
): ContactDiscovery => ({
  status: candidates.length ? "single_match" : "no_match",
  searched: { email: true, phone: true },
  unsearchable: [],
  savedLink: { id: null, status: "none" },
  candidates,
  flags: { ...flags },
  ...over,
});

const identity = buildLocalIdentity({
  kind: "new",
  golfClientId: null,
  firstName: "Ann",
  lastName: "Lee",
  email: "ann@example.com",
  phone: "+12105550100",
});

function approve(
  d: ContactDiscovery,
  request:
    | { action: "approve_existing"; contactId: string; acknowledgedDiscrepancies: string[] }
    | { action: "approve_new"; acknowledgedCandidateIds: string[] },
): ApprovalOutcome {
  const result = evaluateApproval({
    request: {
      ...request,
      discoverySignature: computeDiscoverySignature(d),
    } as Parameters<typeof evaluateApproval>[0]["request"],
    identity,
    discovery: d,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result as ApprovalOutcome;
}

function stagedBatch(
  outcome: ApprovalOutcome | null,
  over: Partial<OpportunitySelectionBatch> = {},
): OpportunitySelectionBatch {
  return {
    id: 1,
    parserMode: "trackman-result",
    demoSessionId: null,
    customerResolution: "new",
    selectedGolfClientId: null,
    proposedFirstName: "Ann",
    proposedLastName: "Lee",
    proposedEmail: "ann@example.com",
    proposedPhone: "+12105550100",
    opportunityResolution: null,
    selectedGhlOpportunityId: null,
    proposedOpportunityName: null,
    fittingDateOverride: null,
    trackmanSessionDate: new Date("2026-05-08T00:00:00Z"),
    ghlContactDecision: outcome?.decision ?? null,
    approvedGhlContactId: outcome?.approvedContactId ?? null,
    ghlContactApprovalSignature: outcome?.signature ?? null,
    ghlContactReviewSnapshot: outcome?.snapshot ?? null,
    client: null,
    ...over,
  };
}

const existingOutcome = () =>
  approve(discovery([candidate()]), {
    action: "approve_existing",
    contactId: "c-1",
    acknowledgedDiscrepancies: [],
  });
const newOutcome = () =>
  approve(discovery([]), { action: "approve_new", acknowledgedCandidateIds: [] });

// ── Gate / routing decision ──────────────────────────────────────────────────

test("gate: persisted approvals survive a reload and are read locally", () => {
  assert.equal(getCurrentGhlDecision(stagedBatch(existingOutcome()), null), "existing");
  assert.equal(getCurrentGhlDecision(stagedBatch(newOutcome()), null), "new");
});

test("gate: unresolved approval is null", () => {
  assert.equal(getCurrentGhlDecision(stagedBatch(null), null), null);
});

test("gate: a changed local identity makes the approval stale", () => {
  const batch = stagedBatch(existingOutcome(), { proposedEmail: "other@example.com" });
  assert.equal(getCurrentGhlDecision(batch, null), null);
  assert.deepEqual(getOpportunityContactScope(batch, null), { kind: "approval_required" });
});

test("gate: a saved GolfClient.ghlContactId is never an approval", () => {
  const batch = stagedBatch(null, {
    customerResolution: "existing",
    selectedGolfClientId: 3,
    client: { firstName: "Ann", lastName: "Lee", email: "ann@example.com", phone: "+12105550100" },
  });
  const gate: GhlGateBatch = batch;
  assert.equal(getCurrentGhlDecision(gate, batch.client), null);
});

test("scope: existing uses the approved contact, new has no contact", () => {
  assert.deepEqual(getOpportunityContactScope(stagedBatch(existingOutcome()), null), {
    kind: "existing",
    contactId: "c-1",
  });
  assert.deepEqual(getOpportunityContactScope(stagedBatch(newOutcome()), null), {
    kind: "new",
  });
});

// ── Opportunity selection ────────────────────────────────────────────────────

const opp = (id: string): GhlOpportunity =>
  ({
    id,
    name: id,
    pipelineStageId: "s",
    status: "open",
    contactId: "c-1",
    locationId: "l",
    pipelineId: "p",
  }) as GhlOpportunity;

function makeDeps(
  batch: OpportunitySelectionBatch | null,
  over: Partial<OpportunitySelectionDeps> = {},
) {
  const calls = { listOpen: [] as string[], validate: [] as string[][], commits: 0 };
  const deps: OpportunitySelectionDeps = {
    loadBatch: async () => batch,
    listOpen: async (contactId) => {
      calls.listOpen.push(contactId);
      return [opp("opp-1")];
    },
    validate: async (opportunityId, contactId) => {
      calls.validate.push([opportunityId, contactId]);
      return { valid: true };
    },
    commit: async () => {
      calls.commits += 1;
      return true;
    },
    ...over,
  };
  return { deps, calls };
}

test("GET: staged-new customer with an approved existing contact lists that contact's opportunities", async () => {
  const { deps, calls } = makeDeps(stagedBatch(existingOutcome()));
  const result = await getOpportunityOptions(deps, 1);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(calls.listOpen, ["c-1"]);
  assert.equal(result.body.canSelectExisting, true);
  assert.equal(result.body.opportunities.length, 1);
});

test("GET: a new-contact decision offers no existing opportunities and makes no GHL call", async () => {
  const { deps, calls } = makeDeps(stagedBatch(newOutcome()));
  const result = await getOpportunityOptions(deps, 1);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.body.canSelectExisting, false);
  assert.deepEqual(result.body.opportunities, []);
  assert.equal(calls.listOpen.length, 0);
});

test("GET/PUT: unresolved or stale approval is rejected with ghl_approval_required", async () => {
  for (const batch of [
    stagedBatch(null),
    stagedBatch(existingOutcome(), { proposedPhone: "+12105559999" }),
  ]) {
    const { deps, calls } = makeDeps(batch);
    const get = await getOpportunityOptions(deps, 1);
    assert.equal(get.ok, false);
    if (!get.ok) assert.equal(get.code, "ghl_approval_required");
    const put = await saveOpportunitySelection(deps, 1, {
      opportunityResolution: "new",
      selectedGhlOpportunityId: null,
    });
    assert.equal(put.ok, false);
    if (!put.ok) {
      assert.equal(put.status, 409);
      assert.equal(put.code, "ghl_approval_required");
    }
    assert.equal(calls.commits, 0);
    assert.equal(calls.listOpen.length, 0);
  }
});

test("PUT: existing opportunity is validated against the approved contact", async () => {
  const { deps, calls } = makeDeps(stagedBatch(existingOutcome()));
  const result = await saveOpportunitySelection(deps, 1, {
    opportunityResolution: "existing",
    selectedGhlOpportunityId: "opp-1",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.validate, [["opp-1", "c-1"]]);
  assert.equal(calls.commits, 1);
});

test("PUT: an opportunity belonging to another contact is rejected without saving", async () => {
  const { deps, calls } = makeDeps(stagedBatch(existingOutcome()), {
    validate: async () => ({ valid: false, reason: "not_relevant" }),
  });
  const result = await saveOpportunitySelection(deps, 1, {
    opportunityResolution: "existing",
    selectedGhlOpportunityId: "opp-other",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 400);
    assert.equal(result.code, "not_relevant");
  }
  assert.equal(calls.commits, 0);
});

test("PUT: a new-contact decision rejects selecting an existing opportunity", async () => {
  const { deps, calls } = makeDeps(stagedBatch(newOutcome()));
  const result = await saveOpportunitySelection(deps, 1, {
    opportunityResolution: "existing",
    selectedGhlOpportunityId: "opp-1",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "existing_opportunity_not_allowed");
  assert.equal(calls.validate.length, 0);
  assert.equal(calls.commits, 0);

  const fresh = await saveOpportunitySelection(deps, 1, {
    opportunityResolution: "new",
    selectedGhlOpportunityId: null,
  });
  assert.equal(fresh.ok, true);
});

test("PUT: GHL validation failure is a 502 and nothing is saved", async () => {
  const { deps, calls } = makeDeps(stagedBatch(existingOutcome()), {
    validate: async () => {
      throw new Error("boom");
    },
  });
  const result = await saveOpportunitySelection(deps, 1, {
    opportunityResolution: "existing",
    selectedGhlOpportunityId: "opp-1",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 502);
  assert.equal(calls.commits, 0);
});

test("PUT: a failed compare-and-set returns 409 state_changed", async () => {
  const { deps } = makeDeps(stagedBatch(existingOutcome()), { commit: async () => false });
  const result = await saveOpportunitySelection(deps, 1, {
    opportunityResolution: "new",
    selectedGhlOpportunityId: null,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "state_changed");
});

test("legacy linked sessions are not mutable through the opportunity API", async () => {
  const { deps, calls } = makeDeps(stagedBatch(null, { demoSessionId: 9 }));
  const get = await getOpportunityOptions(deps, 1);
  assert.equal(get.ok, true);
  if (get.ok) {
    assert.equal(get.body.canModify, false);
    assert.equal(get.body.canSelectExisting, false);
  }
  const put = await saveOpportunitySelection(deps, 1, {
    opportunityResolution: "new",
    selectedGhlOpportunityId: null,
  });
  assert.equal(put.ok, false);
  assert.equal(calls.commits, 0);
});

// ── Approval UI rules ────────────────────────────────────────────────────────

test("ui: discrepancies must all be acknowledged before approving", () => {
  const c = candidate({ discrepancies: ["email", "phone"] });
  assert.deepEqual(missingDiscrepancyAcks(c, ["email"]), ["phone"]);
  assert.deepEqual(missingDiscrepancyAcks(c, ["email", "phone"]), []);
});

test("ui: contact approval is blocked for wrong/unverified location, other customer, saved conflict", () => {
  const d = discovery([]);
  assert.match(candidateApprovalBlock(d, candidate({ wrongLocation: true }))!, /different GHL location/);
  assert.match(candidateApprovalBlock(d, candidate({ locationVerified: false }))!, /location/);
  assert.match(
    candidateApprovalBlock(d, candidate({ linkedClients: [{ id: 2, name: "Bob" }] }))!,
    /another customer/,
  );
  assert.match(
    candidateApprovalBlock(
      discovery([], { savedLink: { id: "saved", status: "verified" } }),
      candidate(),
    )!,
    /different GHL contact/,
  );
  assert.equal(candidateApprovalBlock(d, candidate()), null);
});

test("ui: new contact is blocked when incomplete, unsearchable, saved, or identifier-matched", () => {
  assert.equal(newContactBlock(discovery([])), null);
  assert.ok(newContactBlock(discovery([], { flags: { ...flags, incomplete: true } })));
  assert.ok(newContactBlock(discovery([], { unsearchable: ["phone"] })));
  assert.ok(newContactBlock(discovery([], { searched: { email: false, phone: false } })));
  assert.ok(newContactBlock(discovery([], { savedLink: { id: "s", status: "verified" } })));
  assert.ok(newContactBlock(discovery([candidate()])));
  assert.match(
    newContactBlock(discovery([candidate({ reasons: ["phone"] })])) ?? "",
    /phone/,
  );
});

test("ui: candidate acknowledgments remain explicit but cannot unblock creation", () => {
  const d = discovery([candidate({ id: "a", reasons: ["phone"] }), candidate({ id: "b", reasons: ["phone"] })]);
  assert.deepEqual(missingCandidateAcks(d, ["a"]), ["b"]);
  assert.deepEqual(missingCandidateAcks(d, ["a", "b"]), []);
  assert.ok(newContactBlock(d));
});

test("ui: stale codes trigger a new lookup", () => {
  assert.equal(isStaleApprovalCode("discovery_changed"), true);
  assert.equal(isStaleApprovalCode("state_changed"), true);
  assert.equal(isStaleApprovalCode("acknowledgment_required"), false);
  assert.equal(isStaleApprovalCode(undefined), false);
});

test("ui: Continue requires a current persisted approval", () => {
  assert.equal(canContinueWithApproval(null), false);
  assert.equal(canContinueWithApproval({ current: false }), false);
  assert.equal(canContinueWithApproval({ current: true }), true);
  assert.match(getApprovalContinueHint({ current: false, status: "stale" }) ?? "", /changed/);
  assert.match(getApprovalContinueHint({ current: false, status: "unresolved" }) ?? "", /Choose/);
  assert.equal(getApprovalContinueHint({ current: true, status: "approved_new" }), null);
});
