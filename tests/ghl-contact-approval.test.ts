import test from "node:test";
import assert from "node:assert/strict";
import {
  readGhlApproval,
  updateGhlApproval,
  type ApprovalBatchState,
  type ApprovalDeps,
  type ApprovalWrite,
} from "@/lib/ghl/approveBatchContact";
import type { DiscoveryClientRow } from "@/lib/ghl/discoverBatchContact";
import { discoverContactForBatch } from "@/lib/ghl/discoverBatchContact";
import { computeDiscoverySignature } from "@/lib/ghl/discoverySignature";
import {
  discoverStagedContacts,
  type ContactDiscovery,
  type DiscoveryApi,
  type LinkedClientRow,
} from "@/lib/ghl/discoverStagedContacts";
import type { GhlContactLite } from "@/lib/ghl/resolveStagedContact";
import {
  evaluateApproval,
  getApprovalStatus,
  parseApprovalRequest,
  resolveBatchLocalIdentity,
  shouldClearGhlApprovalOnCustomerChange,
  type ApprovalRequest,
} from "@/lib/imports/ghl-contact-approval";

const LOC = "loc-1";

const contact = (id: string, over: Partial<GhlContactLite> = {}): GhlContactLite => ({
  id,
  locationId: LOC,
  firstName: "Ann",
  lastName: "Lee",
  email: "ann@example.com",
  phone: "+12105550100",
  ...over,
});

const baseBatch = (over: Partial<ApprovalBatchState> = {}): ApprovalBatchState => ({
  id: 1,
  parserMode: "trackman-result",
  demoSessionId: null,
  customerResolution: "new",
  selectedGolfClientId: null,
  proposedFirstName: "Ann",
  proposedLastName: "Lee",
  proposedEmail: "ann@example.com",
  proposedPhone: "+12105550100",
  opportunityResolution: "existing",
  selectedGhlOpportunityId: "opp-1",
  newCustomerConfirmationSignature: null,
  ghlContactDecision: null,
  approvedGhlContactId: null,
  ghlContactApprovalSignature: null,
  ghlContactApprovedAt: null,
  ghlContactApprovedByStaffUserId: null,
  ghlContactReviewSnapshot: null,
  ...over,
});

interface World {
  batch: ApprovalBatchState;
  client: DiscoveryClientRow | null;
  /** Full records returned by GET /contacts/{id}. */
  records: Record<string, GhlContactLite>;
  byEmail: { contacts: GhlContactLite[]; hasMore?: boolean };
  byPhone: { contacts: GhlContactLite[]; hasMore?: boolean };
  linked: LinkedClientRow[];
  beforeCommit?: () => void;
  commits: ApprovalWrite[];
  calls: string[];
}

function makeWorld(over: Partial<World> = {}): World {
  return {
    batch: baseBatch(),
    client: null,
    records: {},
    byEmail: { contacts: [] },
    byPhone: { contacts: [] },
    linked: [],
    commits: [],
    calls: [],
    ...over,
  };
}

const EXPECTED_KEYS = [
  "customerResolution",
  "selectedGolfClientId",
  "proposedFirstName",
  "proposedLastName",
  "proposedEmail",
  "proposedPhone",
  "opportunityResolution",
  "selectedGhlOpportunityId",
  "newCustomerConfirmationSignature",
  "ghlContactDecision",
  "approvedGhlContactId",
  "ghlContactApprovalSignature",
] as const;

// Read-only API: the type has no create/update method, and calls are recorded.
function makeDeps(w: World): ApprovalDeps {
  const api: DiscoveryApi = {
    locationId: () => LOC,
    async getContact(id) {
      w.calls.push(`get:${id}`);
      return w.records[id] ?? null;
    },
    async lookupByEmail(email) {
      w.calls.push(`email:${email}`);
      return { contacts: w.byEmail.contacts, hasMore: w.byEmail.hasMore ?? false };
    },
    async lookupByPhone(phone) {
      w.calls.push(`phone:${phone}`);
      return { contacts: w.byPhone.contacts, hasMore: w.byPhone.hasMore ?? false };
    },
  };
  return {
    api,
    findLinkedClients: async (ids) =>
      w.linked.filter((c) => c.ghlContactId && ids.includes(c.ghlContactId)),
    loadBatch: async () => ({
      ...w.batch,
      newCustomerConfirmationSignature: w.batch.newCustomerConfirmationSignature,
    }),
    loadClient: async () => w.client,
    loadDuplicateClients: async () => [],
    loadApprovalBatch: async () => ({ ...w.batch }),
    async commitApproval(expected, guard, write) {
      w.beforeCommit?.();
      for (const key of EXPECTED_KEYS) {
        if (w.batch[key] !== expected[key]) return false;
      }
      if (guard) {
        const c = w.client;
        if (
          !c ||
          c.ghlContactId !== guard.ghlContactId ||
          c.firstName !== guard.firstName ||
          c.lastName !== guard.lastName ||
          c.email !== guard.email ||
          c.phone !== guard.phone
        ) {
          return false;
        }
      }
      w.batch = {
        ...w.batch,
        ghlContactDecision: write.decision,
        approvedGhlContactId: write.approvedContactId,
        ghlContactApprovalSignature: write.signature,
        ghlContactApprovedAt: write.approvedAt,
        ghlContactApprovedByStaffUserId: write.approvedByStaffUserId,
        ghlContactReviewSnapshot: write.snapshot,
        ...(write.clearOpportunity
          ? { opportunityResolution: null, selectedGhlOpportunityId: null }
          : {}),
      };
      w.commits.push(write);
      return true;
    },
    now: () => new Date("2026-11-04T12:00:00.000Z"),
  };
}

async function signatureOf(w: World): Promise<string> {
  const r = await discoverContactForBatch(makeDeps(w), 1);
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error("unreachable");
  return computeDiscoverySignature(r.discovery);
}

const existing = (contactId: string, sig: string, ack: string[] = []): ApprovalRequest =>
  ({
    action: "approve_existing",
    contactId,
    discoverySignature: sig,
    acknowledgedDiscrepancies: ack,
  }) as ApprovalRequest;

const newContact = (sig: string, ids: string[] = []): ApprovalRequest => ({
  action: "approve_new",
  discoverySignature: sig,
  acknowledgedCandidateIds: ids,
});

function clientRow(over: Partial<DiscoveryClientRow> = {}): DiscoveryClientRow {
  return {
    id: 10,
    firstName: "Ann",
    lastName: "Lee",
    email: "ann@example.com",
    phone: "+12105550100",
    ghlContactId: null,
    ...over,
  };
}

// ── Approvals ────────────────────────────────────────────────────────────────

test("approving an existing contact persists the decision, staff and timestamp, and resets the opportunity", async () => {
  const w = makeWorld({
    byEmail: { contacts: [contact("c1")] },
    byPhone: { contacts: [contact("c1")] },
    records: { c1: contact("c1") },
  });
  const sig = await signatureOf(w);
  const r = await updateGhlApproval(makeDeps(w), 1, existing("c1", sig), 42);

  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.approval.status, "approved_existing");
  assert.equal(r.opportunityCleared, true);
  assert.equal(w.batch.ghlContactDecision, "existing");
  assert.equal(w.batch.approvedGhlContactId, "c1");
  assert.equal(w.batch.ghlContactApprovedByStaffUserId, 42);
  assert.equal(w.batch.ghlContactApprovedAt?.toISOString(), "2026-11-04T12:00:00.000Z");
  assert.equal(w.batch.opportunityResolution, null);
  assert.equal(w.batch.selectedGhlOpportunityId, null);
  // Local identity is never overwritten and the snapshot carries no PII.
  assert.equal(w.batch.proposedEmail, "ann@example.com");
  const snapshot = JSON.stringify(w.batch.ghlContactReviewSnapshot);
  assert.equal(snapshot.includes("ann@example.com"), false);
  assert.equal(snapshot.includes("+12105550100"), false);
  assert.ok(w.calls.every((c) => /^(get|email|phone):/.test(c)));
});

test("approving a new contact is allowed after a complete, empty search", async () => {
  const w = makeWorld();
  const sig = await signatureOf(w);
  const r = await updateGhlApproval(makeDeps(w), 1, newContact(sig), 7);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.approval.status, "approved_new");
  assert.equal(w.batch.ghlContactDecision, "new");
  assert.equal(w.batch.approvedGhlContactId, null);
  assert.equal(w.batch.opportunityResolution, null);
});

test("an email discrepancy must be explicitly acknowledged and the GHL email is not touched", async () => {
  const w = makeWorld({
    byPhone: { contacts: [contact("c1", { email: "other@example.com" })] },
    records: { c1: contact("c1", { email: "other@example.com" }) },
  });
  const sig = await signatureOf(w);

  const rejected = await updateGhlApproval(makeDeps(w), 1, existing("c1", sig), 1);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.equal(rejected.httpStatus, 409);
    assert.equal(rejected.code, "acknowledgment_required");
    assert.deepEqual(rejected.details?.required, ["email"]);
  }
  assert.equal(w.batch.ghlContactDecision, null);

  const ok = await updateGhlApproval(makeDeps(w), 1, existing("c1", sig, ["email"]), 1);
  assert.equal(ok.ok, true);
  assert.deepEqual(
    (w.batch.ghlContactReviewSnapshot as { acknowledgedDiscrepancies: string[] })
      .acknowledgedDiscrepancies,
    ["email"],
  );
  assert.equal(w.batch.proposedEmail, "ann@example.com");
  assert.equal(w.records.c1!.email, "other@example.com");
});

test("a phone discrepancy must be explicitly acknowledged", async () => {
  const w = makeWorld({
    byEmail: { contacts: [contact("c1", { phone: "+12105559999" })] },
    records: { c1: contact("c1", { phone: "+12105559999" }) },
  });
  const sig = await signatureOf(w);
  const rejected = await updateGhlApproval(makeDeps(w), 1, existing("c1", sig), 1);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.deepEqual(rejected.details?.missing, ["phone"]);
  const ok = await updateGhlApproval(makeDeps(w), 1, existing("c1", sig, ["phone"]), 1);
  assert.equal(ok.ok, true);
});

test("a stale discovery signature is rejected when the candidate set changes", async () => {
  const w = makeWorld({
    byEmail: { contacts: [contact("c1")] },
    records: { c1: contact("c1") },
  });
  const sig = await signatureOf(w);
  w.byPhone = { contacts: [contact("c2", { email: "x@example.com" })] };
  w.records.c2 = contact("c2", { email: "x@example.com" });

  const r = await updateGhlApproval(makeDeps(w), 1, existing("c1", sig), 1);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.httpStatus, 409);
    assert.equal(r.code, "discovery_changed");
  }
  assert.equal(w.batch.ghlContactDecision, null);
  assert.equal(w.batch.opportunityResolution, "existing");

  const forged = await updateGhlApproval(makeDeps(w), 1, existing("c1", "0".repeat(64)), 1);
  assert.equal(forged.ok === false && forged.code, "discovery_changed");
});

test("a contact in another GHL location cannot be approved", async () => {
  const other = contact("c1", { locationId: "other-loc" });
  const w = makeWorld({ byEmail: { contacts: [other] }, records: { c1: other } });
  const r = await updateGhlApproval(makeDeps(w), 1, existing("c1", await signatureOf(w)), 1);
  assert.equal(r.ok === false && r.code, "location_unverified");
  assert.equal(w.batch.ghlContactDecision, null);
});

test("a contact with an unknown location is not treated as verified", async () => {
  const noLoc = contact("c1", { locationId: undefined });
  const w = makeWorld({ byEmail: { contacts: [noLoc] }, records: { c1: noLoc } });
  const r = await updateGhlApproval(makeDeps(w), 1, existing("c1", await signatureOf(w)), 1);
  assert.equal(r.ok === false && r.code, "location_unverified");
});

test("a lookup result without a location is verified from the full contact record", async () => {
  const w = makeWorld({
    byEmail: { contacts: [contact("c1", { locationId: undefined })] },
    records: { c1: contact("c1") },
  });
  const d = await discoverContactForBatch(makeDeps(w), 1);
  assert.equal(d.ok && d.discovery.candidates[0]!.locationVerified, true);
  const r = await updateGhlApproval(makeDeps(w), 1, existing("c1", await signatureOf(w)), 1);
  assert.equal(r.ok, true);
});

test("discovery marks verification per contact and never trusts a missing locationId", async () => {
  const api: DiscoveryApi = {
    locationId: () => LOC,
    getContact: async () => null,
    lookupByEmail: async () => ({
      contacts: [contact("a", { locationId: undefined }), contact("b")],
      hasMore: false,
    }),
    lookupByPhone: async () => ({ contacts: [], hasMore: false }),
  };
  const d = await discoverStagedContacts(
    { api, findLinkedClients: async () => [] },
    {
      identity: { firstName: "Ann", lastName: "Lee", email: "ann@example.com", phone: null },
      savedContactId: null,
      ownClientId: null,
    },
  );
  const byId = Object.fromEntries(d.candidates.map((c) => [c.id, c.locationVerified]));
  assert.deepEqual(byId, { a: false, b: true });
});

test("a contact linked to another GolfClient cannot be approved", async () => {
  const w = makeWorld({
    byEmail: { contacts: [contact("c1")] },
    records: { c1: contact("c1") },
    linked: [{ id: 5, firstName: "Bob", lastName: null, ghlContactId: "c1" }],
  });
  const r = await updateGhlApproval(makeDeps(w), 1, existing("c1", await signatureOf(w)), 1);
  assert.equal(r.ok === false && r.code, "linked_to_other_customer");
  assert.equal(w.batch.ghlContactDecision, null);
});

test("an existing customer with a different saved GHL contact cannot be reassigned", async () => {
  const w = makeWorld({
    batch: baseBatch({
      customerResolution: "existing",
      selectedGolfClientId: 10,
      proposedFirstName: null,
      proposedLastName: null,
      proposedEmail: null,
      proposedPhone: null,
    }),
    client: clientRow({ ghlContactId: "c9" }),
    records: { c9: contact("c9"), c1: contact("c1") },
    byEmail: { contacts: [contact("c1")] },
  });
  const sig = await signatureOf(w);

  const reassign = await updateGhlApproval(makeDeps(w), 1, existing("c1", sig), 1);
  assert.equal(reassign.ok === false && reassign.code, "saved_contact_conflict");
  const asNew = await updateGhlApproval(makeDeps(w), 1, newContact(sig, ["c1", "c9"]), 1);
  assert.equal(asNew.ok === false && asNew.code, "saved_contact_conflict");
  assert.equal(w.batch.ghlContactDecision, null);

  const keep = await updateGhlApproval(makeDeps(w), 1, existing("c9", sig), 1);
  assert.equal(keep.ok, true);
  assert.equal(w.client!.ghlContactId, "c9");
});

test("new-contact approval is rejected when the search is incomplete", async () => {
  const w = makeWorld({ byEmail: { contacts: [], hasMore: true } });
  const r = await updateGhlApproval(makeDeps(w), 1, newContact(await signatureOf(w)), 1);
  assert.equal(r.ok === false && r.code, "discovery_incomplete");
  assert.equal(w.batch.ghlContactDecision, null);
});

test("new-contact approval requires acknowledging phone-only matches and is blocked by an email match", async () => {
  const phoneOnly = contact("c1", { email: "other@example.com" });
  const w = makeWorld({ byPhone: { contacts: [phoneOnly] }, records: { c1: phoneOnly } });
  const sig = await signatureOf(w);
  const missing = await updateGhlApproval(makeDeps(w), 1, newContact(sig), 1);
  assert.equal(missing.ok === false && missing.code, "candidate_acknowledgment_required");
  const ok = await updateGhlApproval(makeDeps(w), 1, newContact(sig, ["c1"]), 1);
  assert.equal(ok.ok, true);

  const w2 = makeWorld({
    byEmail: { contacts: [contact("c2")] },
    records: { c2: contact("c2") },
  });
  const blocked = await updateGhlApproval(
    makeDeps(w2),
    1,
    newContact(await signatureOf(w2), ["c2"]),
    1,
  );
  assert.equal(blocked.ok === false && blocked.code, "email_match_exists");
});

test("unsearchable identifiers block new-contact approval", () => {
  const discovery: ContactDiscovery = {
    status: "no_match",
    searched: { email: false, phone: true },
    unsearchable: ["email"],
    savedLink: { id: null, status: "none" },
    candidates: [],
    flags: {
      multipleMatches: false,
      identifierConflict: false,
      identityConflict: false,
      wrongLocation: false,
      linkedElsewhere: false,
      incomplete: false,
      savedLinkMissing: false,
      savedLinkMismatch: false,
    },
  };
  const identity = resolveBatchLocalIdentity(baseBatch(), null)!;
  const r = evaluateApproval({
    request: {
      action: "approve_new",
      discoverySignature: computeDiscoverySignature(discovery),
      acknowledgedCandidateIds: [],
    },
    identity,
    discovery,
  });
  assert.equal(r.ok === false && r.code, "nothing_searched");
});

test("a contact that is not in the recomputed discovery is rejected", async () => {
  const w = makeWorld({ byEmail: { contacts: [contact("c1")] }, records: { c1: contact("c1") } });
  const r = await updateGhlApproval(makeDeps(w), 1, existing("zzz", await signatureOf(w)), 1);
  assert.equal(r.ok === false && r.code, "contact_not_in_discovery");
});

test("unresolved customers, local duplicate reviews and linked batches are rejected", async () => {
  const unresolved = makeWorld({ batch: baseBatch({ customerResolution: null }) });
  const r1 = await updateGhlApproval(makeDeps(unresolved), 1, newContact("0".repeat(64)), 1);
  assert.equal(r1.ok === false && r1.code, "customer_unresolved");

  const linked = makeWorld({ batch: baseBatch({ demoSessionId: 3 }) });
  const r2 = await updateGhlApproval(makeDeps(linked), 1, { action: "clear" }, 1);
  assert.equal(r2.ok === false && r2.code, "not_stageable");
});

// ── Clearing and invalidation ────────────────────────────────────────────────

test("clearing removes the approval and resets the opportunity; clearing twice is harmless", async () => {
  const w = makeWorld({ byEmail: { contacts: [contact("c1")] }, records: { c1: contact("c1") } });
  await updateGhlApproval(makeDeps(w), 1, existing("c1", await signatureOf(w)), 1);
  w.batch = { ...w.batch, opportunityResolution: "new" };

  const cleared = await updateGhlApproval(makeDeps(w), 1, { action: "clear" }, 1);
  assert.equal(cleared.ok, true);
  if (cleared.ok) {
    assert.equal(cleared.approval.status, "unresolved");
    assert.equal(cleared.opportunityCleared, true);
  }
  assert.equal(w.batch.ghlContactDecision, null);
  assert.equal(w.batch.approvedGhlContactId, null);
  assert.equal(w.batch.ghlContactApprovalSignature, null);
  assert.equal(w.batch.ghlContactReviewSnapshot, null);
  assert.equal(w.batch.opportunityResolution, null);

  const again = await updateGhlApproval(makeDeps(w), 1, { action: "clear" }, 1);
  assert.equal(again.ok && again.opportunityCleared, false);
});

test("re-approving the same contact keeps the opportunity; a different decision resets it", async () => {
  const w = makeWorld({ byEmail: { contacts: [contact("c1")] }, records: { c1: contact("c1") } });
  await updateGhlApproval(makeDeps(w), 1, existing("c1", await signatureOf(w)), 1);
  w.batch = { ...w.batch, opportunityResolution: "existing", selectedGhlOpportunityId: "opp-9" };

  const same = await updateGhlApproval(makeDeps(w), 1, existing("c1", await signatureOf(w)), 2);
  assert.equal(same.ok && same.opportunityCleared, false);
  assert.equal(w.batch.selectedGhlOpportunityId, "opp-9");

  w.byEmail = { contacts: [] };
  w.byPhone = { contacts: [] };
  const toNew = await updateGhlApproval(makeDeps(w), 1, newContact(await signatureOf(w)), 2);
  assert.equal(toNew.ok && toNew.opportunityCleared, true);
  assert.equal(w.batch.selectedGhlOpportunityId, null);
});

test("persisted approval survives refresh and is invalidated by any identity change", async () => {
  const w = makeWorld({ byEmail: { contacts: [contact("c1")] }, records: { c1: contact("c1") } });
  await updateGhlApproval(makeDeps(w), 1, existing("c1", await signatureOf(w)), 1);

  const calls = w.calls.length;
  const fresh = await readGhlApproval(makeDeps(w), 1);
  assert.equal(fresh.ok && fresh.approval.current, true);
  assert.equal(fresh.ok && fresh.approval.approvedContactId, "c1");
  assert.equal(w.calls.length, calls, "GET makes no GHL request");

  const changes: Partial<ApprovalBatchState>[] = [
    { proposedFirstName: "Anne" },
    { proposedLastName: "Leigh" },
    { proposedEmail: "ann2@example.com" },
    { proposedPhone: "+12105550199" },
  ];
  const approved = w.batch;
  for (const change of changes) {
    w.batch = { ...approved, ...change };
    const r = await readGhlApproval(makeDeps(w), 1);
    assert.equal(r.ok && r.approval.status, "stale", JSON.stringify(change));
    assert.equal(r.ok && r.approval.current, false);
    assert.equal(r.ok && r.approval.approvedContactId, null);
  }
  w.batch = approved;
  assert.equal((await readGhlApproval(makeDeps(w), 1)).ok, true);
});

test("a changed GolfClient identity makes an existing-customer approval stale", async () => {
  const w = makeWorld({
    batch: baseBatch({
      customerResolution: "existing",
      selectedGolfClientId: 10,
      proposedFirstName: null,
      proposedLastName: null,
      proposedEmail: null,
      proposedPhone: null,
    }),
    client: clientRow(),
    byEmail: { contacts: [contact("c1")] },
    records: { c1: contact("c1") },
  });
  await updateGhlApproval(makeDeps(w), 1, existing("c1", await signatureOf(w)), 1);
  assert.equal((await readGhlApproval(makeDeps(w), 1)).ok && true, true);
  w.client = clientRow({ email: "changed@example.com" });
  const r = await readGhlApproval(makeDeps(w), 1);
  assert.equal(r.ok && r.approval.status, "stale");
});

test("customer identity changes clear the approval; unchanged identity keeps it", () => {
  const current = {
    customerResolution: "new" as const,
    selectedGolfClientId: null,
    proposedFirstName: "Ann",
    proposedLastName: "Lee",
    proposedEmail: "ann@example.com",
    proposedPhone: "+12105550100",
  };
  assert.equal(shouldClearGhlApprovalOnCustomerChange(current, { ...current }), false);
  for (const change of [
    { proposedFirstName: "Anne" },
    { proposedLastName: "Leigh" },
    { proposedEmail: "x@example.com" },
    { proposedPhone: "+12105550199" },
    { customerResolution: "existing" as const, selectedGolfClientId: 3 },
  ]) {
    assert.equal(
      shouldClearGhlApprovalOnCustomerChange(current, { ...current, ...change }),
      true,
      JSON.stringify(change),
    );
  }
});

// ── Concurrency ──────────────────────────────────────────────────────────────

test("a concurrent identity change between discovery and write returns 409 and writes nothing", async () => {
  const w = makeWorld({ byEmail: { contacts: [contact("c1")] }, records: { c1: contact("c1") } });
  const sig = await signatureOf(w);
  w.beforeCommit = () => {
    w.batch = { ...w.batch, proposedEmail: "new@example.com" };
  };
  const r = await updateGhlApproval(makeDeps(w), 1, existing("c1", sig), 1);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.httpStatus, 409);
    assert.equal(r.code, "state_changed");
  }
  assert.equal(w.batch.ghlContactDecision, null);
  assert.equal(w.commits.length, 0);
});

test("a concurrent decision or GolfClient link change is detected by the compare-and-set", async () => {
  const w = makeWorld({ byEmail: { contacts: [contact("c1")] }, records: { c1: contact("c1") } });
  const sig = await signatureOf(w);
  w.beforeCommit = () => {
    w.batch = { ...w.batch, ghlContactDecision: "new" };
  };
  const r = await updateGhlApproval(makeDeps(w), 1, existing("c1", sig), 1);
  assert.equal(r.ok === false && r.code, "state_changed");

  const w2 = makeWorld({
    batch: baseBatch({
      customerResolution: "existing",
      selectedGolfClientId: 10,
      proposedFirstName: null,
      proposedLastName: null,
      proposedEmail: null,
      proposedPhone: null,
    }),
    client: clientRow(),
    byEmail: { contacts: [contact("c1")] },
    records: { c1: contact("c1") },
  });
  const sig2 = await signatureOf(w2);
  w2.beforeCommit = () => {
    w2.client = clientRow({ ghlContactId: "c77" });
  };
  const r2 = await updateGhlApproval(makeDeps(w2), 1, existing("c1", sig2), 1);
  assert.equal(r2.ok === false && r2.code, "state_changed");
  assert.equal(w2.batch.ghlContactDecision, null);
});

// ── Request parsing and state classification ────────────────────────────────

test("a saved GHL id with surrounding whitespace approves, and the guard compares the raw value", async () => {
  const w = makeWorld({
    batch: baseBatch({
      customerResolution: "existing",
      selectedGolfClientId: 10,
      proposedFirstName: null,
      proposedLastName: null,
      proposedEmail: null,
      proposedPhone: null,
    }),
    client: clientRow({ ghlContactId: " c1 " }),
    byEmail: { contacts: [contact("c1")] },
    records: { c1: contact("c1") },
  });
  const sig = await signatureOf(w);
  const r = await updateGhlApproval(makeDeps(w), 1, existing("c1", sig), 1);
  assert.equal(r.ok, true);
  assert.equal(w.batch.approvedGhlContactId, "c1");
  // GolfClient.ghlContactId is never rewritten (not even trimmed).
  assert.equal(w.client!.ghlContactId, " c1 ");

  // A concurrent change to the raw saved value is still detected.
  const w2 = makeWorld({
    batch: baseBatch({
      customerResolution: "existing",
      selectedGolfClientId: 10,
      proposedFirstName: null,
      proposedLastName: null,
      proposedEmail: null,
      proposedPhone: null,
    }),
    client: clientRow({ ghlContactId: " c1 " }),
    byEmail: { contacts: [contact("c1")] },
    records: { c1: contact("c1") },
  });
  const sig2 = await signatureOf(w2);
  w2.beforeCommit = () => {
    w2.client = clientRow({ ghlContactId: "c1" });
  };
  const r2 = await updateGhlApproval(makeDeps(w2), 1, existing("c1", sig2), 1);
  assert.equal(r2.ok === false && r2.code, "state_changed");
});

test("a concurrent change to the local duplicate-review confirmation is detected", async () => {
  const w = makeWorld({ byEmail: { contacts: [contact("c1")] }, records: { c1: contact("c1") } });
  const sig = await signatureOf(w);
  w.beforeCommit = () => {
    w.batch = { ...w.batch, newCustomerConfirmationSignature: "b".repeat(64) };
  };
  const r = await updateGhlApproval(makeDeps(w), 1, existing("c1", sig), 1);
  assert.equal(r.ok === false && r.code, "state_changed");
  assert.equal(w.batch.ghlContactDecision, null);
  assert.equal(w.commits.length, 0);
});

test("request parsing rejects malformed ids, signatures, actions and acknowledgments", () => {
  const sig = "a".repeat(64);
  const bad = (body: unknown) => {
    const r = parseApprovalRequest(body);
    assert.equal(r.ok, false, JSON.stringify(body));
  };
  bad(null);
  bad([]);
  bad({ action: "nope" });
  bad({ action: "approve_existing", contactId: "c1" });
  bad({ action: "approve_existing", contactId: "bad id!", discoverySignature: sig });
  bad({ action: "approve_existing", contactId: "c1", discoverySignature: "short" });
  bad({
    action: "approve_existing",
    contactId: "c1",
    discoverySignature: sig,
    acknowledgedDiscrepancies: ["nickname"],
  });
  bad({ action: "approve_new", discoverySignature: sig, acknowledgedCandidateIds: ["x y"] });
  assert.equal(parseApprovalRequest({ action: "clear" }).ok, true);
  const invalidId = parseApprovalRequest({
    action: "approve_existing",
    contactId: "../x",
    discoverySignature: sig,
  });
  assert.equal(!invalidId.ok && invalidId.code, "invalid_contact_id");
});

test("approval status distinguishes unresolved, approved and stale states", () => {
  const identity = resolveBatchLocalIdentity(baseBatch(), null)!;
  const empty = {
    decision: null,
    approvedContactId: null,
    signature: null,
    approvedAt: null,
    approvedByStaffUserId: null,
    snapshot: null,
  };
  assert.equal(getApprovalStatus(empty, identity), "unresolved");
  assert.equal(getApprovalStatus({ ...empty, decision: "existing" }, identity), "stale");
  assert.equal(
    getApprovalStatus({ ...empty, decision: "bogus", signature: "x", snapshot: {} }, identity),
    "stale",
  );
});
