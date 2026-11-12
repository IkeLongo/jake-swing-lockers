import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSuggestedOpportunityName,
  formatFittingDate,
  parseFittingDateOverride,
  parseOpportunityName,
  resolveFittingDate,
} from "../lib/imports/opportunity-naming";
import {
  getOpportunityOptions,
  saveOpportunitySelection,
  type OpportunitySelectionBatch,
  type OpportunitySelectionDeps,
} from "../lib/imports/opportunity-selection";
import {
  computeApprovalSignature,
  resolveBatchLocalIdentity,
  type GhlReviewSnapshot,
} from "../lib/imports/ghl-contact-approval";
import type { OpportunityResolutionState } from "../lib/imports/opportunity-resolution";

test("suggested name uses the customer, default type and the UTC calendar date", () => {
  // 23:30 UTC-evening wall clock must stay on Nov 5 regardless of server timezone.
  const lateEvening = new Date(Date.UTC(2026, 10, 5, 23, 30));
  assert.equal(formatFittingDate(lateEvening), "Nov 5, 2026");
  assert.equal(
    buildSuggestedOpportunityName({ firstName: "John", lastName: "Smith", fittingDate: lateEvening }),
    "John Smith — Golf Fitting — Nov 5, 2026",
  );
  assert.equal(
    buildSuggestedOpportunityName({
      firstName: " Ann ",
      lastName: null,
      fittingDate: new Date(Date.UTC(2026, 0, 1)),
      fittingType: "Driver Fitting",
    }),
    "Ann — Driver Fitting — Jan 1, 2026",
  );
});

test("fitting date resolves from TrackMan first, then the override, else null", () => {
  const t = new Date("2026-05-08T12:00:00Z");
  const o = new Date("2026-06-01T00:00:00Z");
  assert.equal(resolveFittingDate({ trackmanSessionDate: t, fittingDateOverride: o }), t);
  assert.equal(resolveFittingDate({ trackmanSessionDate: null, fittingDateOverride: o }), o);
  assert.equal(resolveFittingDate({ trackmanSessionDate: null, fittingDateOverride: null }), null);
});

test("name and date validation", () => {
  assert.deepEqual(parseOpportunityName("  A — B "), { ok: true, value: "A — B" });
  assert.equal(parseOpportunityName("").ok, false);
  assert.equal(parseOpportunityName("x".repeat(256)).ok, false);
  assert.equal(parseOpportunityName("x".repeat(255)).ok, true);
  assert.deepEqual(parseFittingDateOverride("2026-11-05"), {
    ok: true,
    value: new Date("2026-11-05T00:00:00.000Z"),
  });
  for (const bad of ["2026-13-01", "2026-02-29", "1999-01-01", "nov 5", 20261105, null]) {
    assert.equal(parseFittingDateOverride(bad).ok, false, String(bad));
  }
});

// ── Selection API behaviour ──────────────────────────────────────────────────

const snapshot: GhlReviewSnapshot = {
  v: 1,
  discoverySignature: "a".repeat(64),
  incomplete: false,
  candidates: [],
  acknowledgedDiscrepancies: [],
  acknowledgedCandidateIds: [],
};

function batchWith(over: Partial<OpportunitySelectionBatch> = {}): OpportunitySelectionBatch {
  const base = {
    id: 1,
    parserMode: "trackman-result",
    demoSessionId: null,
    customerResolution: "new",
    selectedGolfClientId: null,
    proposedFirstName: "Ann",
    proposedLastName: "Lee",
    proposedEmail: "ann@example.com",
    proposedPhone: null,
    opportunityResolution: null,
    selectedGhlOpportunityId: null,
    proposedOpportunityName: null,
    fittingDateOverride: null,
    trackmanSessionDate: new Date("2026-11-05T14:00:00Z"),
    client: null,
    ghlContactDecision: "new",
    approvedGhlContactId: null,
    ghlContactApprovalSignature: null,
    ghlContactReviewSnapshot: snapshot,
    ...over,
  } as OpportunitySelectionBatch;
  const identity = resolveBatchLocalIdentity(base, base.client);
  assert.ok(identity);
  return {
    ...base,
    ghlContactApprovalSignature: computeApprovalSignature({
      identity,
      decision: "new",
      approvedContactId: null,
      snapshot,
    }),
  };
}

function setup(batch: OpportunitySelectionBatch) {
  const store = { batch, commits: [] as OpportunityResolutionState[] };
  const deps: OpportunitySelectionDeps = {
    loadBatch: async () => ({ ...store.batch }),
    listOpen: async () => [],
    validate: async () => ({ valid: true }),
    commit: async (_expected, state) => {
      store.commits.push(state);
      store.batch = {
        ...store.batch,
        opportunityResolution: state.opportunityResolution,
        selectedGhlOpportunityId: state.selectedGhlOpportunityId,
        proposedOpportunityName: state.proposedOpportunityName,
        fittingDateOverride: state.fittingDateOverride,
      };
      return true;
    },
  };
  return { deps, store };
}

const NEW = { opportunityResolution: "new", selectedGhlOpportunityId: null } as const;

test("GET returns the suggestion and effective TrackMan date", async () => {
  const { deps } = setup(batchWith());
  const r = await getOpportunityOptions(deps, 1);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.body.suggestedOpportunityName, "Ann Lee — Golf Fitting — Nov 5, 2026");
  assert.equal(r.body.fittingDate, "2026-11-05T14:00:00.000Z");
  assert.equal(r.body.fittingDateSource, "trackman");
});

test("PUT new defaults to the suggested name and persists it across a reload", async () => {
  const { deps, store } = setup(batchWith());
  const saved = await saveOpportunitySelection(deps, 1, NEW);
  assert.equal(saved.ok, true);
  assert.equal(store.batch.proposedOpportunityName, "Ann Lee — Golf Fitting — Nov 5, 2026");
  assert.equal(store.batch.fittingDateOverride, null);

  const reload = await getOpportunityOptions(deps, 1);
  assert.equal(reload.ok && reload.body.state.proposedOpportunityName, "Ann Lee — Golf Fitting — Nov 5, 2026");
});

test("PUT new stores a custom name and a repeat PUT without one keeps it", async () => {
  const { deps, store } = setup(batchWith());
  await saveOpportunitySelection(deps, 1, { ...NEW, proposedOpportunityName: "Ann Lee — Driver Fitting — Nov 5, 2026" });
  assert.equal(store.batch.proposedOpportunityName, "Ann Lee — Driver Fitting — Nov 5, 2026");
  await saveOpportunitySelection(deps, 1, NEW);
  assert.equal(store.batch.proposedOpportunityName, "Ann Lee — Driver Fitting — Nov 5, 2026");
});

test("missing TrackMan date requires an override, which then drives the suggestion", async () => {
  const { deps, store } = setup(batchWith({ trackmanSessionDate: null }));
  const none = await saveOpportunitySelection(deps, 1, NEW);
  assert.equal(none.ok === false && none.code, "fitting_date_required");
  assert.equal(store.commits.length, 0);

  const get = await getOpportunityOptions(deps, 1);
  assert.equal(get.ok && get.body.suggestedOpportunityName, null);

  const saved = await saveOpportunitySelection(deps, 1, {
    ...NEW,
    fittingDateOverride: new Date("2026-03-09T00:00:00Z"),
  });
  assert.equal(saved.ok, true);
  assert.equal(store.batch.proposedOpportunityName, "Ann Lee — Golf Fitting — Mar 9, 2026");
  assert.equal(store.batch.fittingDateOverride?.toISOString(), "2026-03-09T00:00:00.000Z");
});

test("a fitting-date override is rejected when TrackMan supplied the date", async () => {
  const { deps, store } = setup(batchWith());
  const r = await saveOpportunitySelection(deps, 1, {
    ...NEW,
    fittingDateOverride: new Date("2026-03-09T00:00:00Z"),
  });
  assert.equal(r.ok === false && r.code, "fitting_date_not_allowed");
  assert.equal(store.commits.length, 0);
});

test("existing opportunity selection stores no name or override", async () => {
  const approved = batchWith({
    customerResolution: "existing",
    selectedGolfClientId: 3,
    proposedFirstName: null,
    proposedLastName: null,
    proposedEmail: null,
    client: { firstName: "Ann", lastName: "Lee", email: "ann@example.com", phone: null, ghlContactId: "c-1" },
    ghlContactDecision: "existing",
    approvedGhlContactId: "c-1",
    opportunityResolution: "new",
    proposedOpportunityName: "stale",
  });
  const identity = resolveBatchLocalIdentity(approved, approved.client);
  assert.ok(identity);
  const { deps, store } = setup({
    ...approved,
    ghlContactApprovalSignature: computeApprovalSignature({
      identity,
      decision: "existing",
      approvedContactId: "c-1",
      snapshot,
    }),
  });
  const r = await saveOpportunitySelection(deps, 1, {
    opportunityResolution: "existing",
    selectedGhlOpportunityId: "opp-1",
  });
  assert.equal(r.ok, true);
  assert.equal(store.batch.proposedOpportunityName, null);
  assert.equal(store.batch.fittingDateOverride, null);
  assert.equal(store.batch.selectedGhlOpportunityId, "opp-1");
});

// ── Checkpoint B: UI draft logic and the request it builds ───────────────────

import {
  applyDateChange,
  buildNamingDraft,
  buildNewOpportunityBody,
  isNameCustomized,
  isNamingSaved,
  requiresNamingSave,
  resetToSuggested,
  suggestOpportunityNameFor,
  validateNamingDraft,
  type OpportunityNamingInfo,
} from "../lib/imports/opportunity-page";
import { parseOpportunityResolution } from "../lib/imports/opportunity-resolution";

const CUSTOMER = "Ann Lee";

function info(over: Partial<OpportunityNamingInfo> = {}): OpportunityNamingInfo {
  return {
    fittingDate: "2026-11-05T14:00:00.000Z",
    fittingDateSource: "trackman",
    suggestedOpportunityName: "Ann Lee — Golf Fitting — Nov 5, 2026",
    customerName: CUSTOMER,
    state: {
      opportunityResolution: null,
      selectedGhlOpportunityId: null,
      proposedOpportunityName: null,
      fittingDateOverride: null,
    },
    ...over,
  };
}

test("draft initializes from the server suggestion, or from the stored name", () => {
  assert.deepEqual(buildNamingDraft(info()), {
    date: "2026-11-05",
    name: "Ann Lee — Golf Fitting — Nov 5, 2026",
  });
  const stored = info({
    state: {
      opportunityResolution: "new",
      selectedGhlOpportunityId: null,
      proposedOpportunityName: "Custom",
      fittingDateOverride: null,
    },
  });
  assert.equal(buildNamingDraft(stored).name, "Custom");
  assert.deepEqual(
    buildNamingDraft(info({ fittingDate: null, suggestedOpportunityName: null })),
    { date: "", name: "" },
  );
});

test("client suggestion matches the server suggestion", () => {
  assert.equal(
    suggestOpportunityNameFor(CUSTOMER, "2026-11-05"),
    "Ann Lee — Golf Fitting — Nov 5, 2026",
  );
  assert.equal(suggestOpportunityNameFor("", "2026-11-05"), "Golf Customer — Golf Fitting — Nov 5, 2026");
  assert.equal(suggestOpportunityNameFor(CUSTOMER, ""), null);
});

test("a date change re-suggests the name only while it is not customized", () => {
  const plain = { date: "2026-03-09", name: "Ann Lee — Golf Fitting — Mar 9, 2026" };
  assert.equal(isNameCustomized(plain, CUSTOMER), false);
  assert.deepEqual(applyDateChange(plain, CUSTOMER, "2026-03-10"), {
    date: "2026-03-10",
    name: "Ann Lee — Golf Fitting — Mar 10, 2026",
  });
  const custom = { date: "2026-03-09", name: "Ann Lee — Driver Fitting" };
  assert.equal(isNameCustomized(custom, CUSTOMER), true);
  assert.deepEqual(applyDateChange(custom, CUSTOMER, "2026-03-10"), {
    date: "2026-03-10",
    name: "Ann Lee — Driver Fitting",
  });
  // First entry of a missing date fills the suggestion into the empty name.
  assert.equal(
    applyDateChange({ date: "", name: "" }, CUSTOMER, "2026-03-09").name,
    "Ann Lee — Golf Fitting — Mar 9, 2026",
  );
});

test("reset to suggested restores the name for the current date", () => {
  const custom = { date: "2026-03-09", name: "Whatever" };
  assert.deepEqual(resetToSuggested(custom, CUSTOMER), {
    date: "2026-03-09",
    name: "Ann Lee — Golf Fitting — Mar 9, 2026",
  });
});

test("missing or invalid fitting date and blank name cannot be saved", () => {
  assert.ok(validateNamingDraft({ date: "", name: "X" }, null));
  assert.ok(validateNamingDraft({ date: "2026-02-30", name: "X" }, "override"));
  assert.ok(validateNamingDraft({ date: "2026-03-09", name: "  " }, "override"));
  assert.equal(validateNamingDraft({ date: "2026-03-09", name: "X" }, "override"), null);
  // TrackMan supplies the date, so no date input is required.
  assert.equal(validateNamingDraft({ date: "2026-11-05", name: "X" }, "trackman"), null);
});

test("request body omits the date for TrackMan and sends the name explicitly", () => {
  assert.deepEqual(
    buildNewOpportunityBody({ date: "2026-11-05", name: " N " }, "trackman"),
    { resolution: "new", opportunityName: "N" },
  );
  assert.deepEqual(
    buildNewOpportunityBody({ date: "2026-03-09", name: "N" }, "override"),
    { resolution: "new", opportunityName: "N", fittingDate: "2026-03-09" },
  );
});

test("a customized name survives a date-override change through the real PUT path", async () => {
  const { deps, store } = setup(batchWith({ trackmanSessionDate: null }));
  const save = async (draft: { date: string; name: string }) => {
    const parsed = parseOpportunityResolution(buildNewOpportunityBody(draft, null));
    assert.ok(parsed.success);
    return saveOpportunitySelection(deps, 1, parsed.state);
  };

  await save({ date: "2026-03-09", name: "Ann Lee — Driver Fitting" });
  assert.equal(store.batch.proposedOpportunityName, "Ann Lee — Driver Fitting");

  const changed = applyDateChange(
    { date: "2026-03-09", name: "Ann Lee — Driver Fitting" },
    CUSTOMER,
    "2026-04-01",
  );
  await save(changed);
  assert.equal(store.batch.proposedOpportunityName, "Ann Lee — Driver Fitting");
  assert.equal(store.batch.fittingDateOverride?.toISOString(), "2026-04-01T00:00:00.000Z");

  // An uncustomized name follows the new date, with the name resent by the UI.
  const auto = applyDateChange(
    { date: "2026-04-01", name: "Ann Lee — Golf Fitting — Apr 1, 2026" },
    CUSTOMER,
    "2026-04-02",
  );
  await save(auto);
  assert.equal(store.batch.proposedOpportunityName, "Ann Lee — Golf Fitting — Apr 2, 2026");
});

test("saved values reload into the same draft and read as saved", async () => {
  const { deps, store } = setup(batchWith({ trackmanSessionDate: null }));
  await saveOpportunitySelection(deps, 1, {
    ...NEW,
    proposedOpportunityName: "Ann Lee — Driver Fitting",
    fittingDateOverride: new Date("2026-03-09T00:00:00Z"),
  });
  const reload = await getOpportunityOptions(deps, 1);
  assert.ok(reload.ok);
  const wire = JSON.parse(JSON.stringify(reload.body)) as OpportunityNamingInfo;
  assert.equal(wire.fittingDateSource, "override");
  const draft = buildNamingDraft(wire);
  assert.deepEqual(draft, { date: "2026-03-09", name: "Ann Lee — Driver Fitting" });
  assert.equal(isNamingSaved(draft, wire), true);
  assert.equal(isNamingSaved({ ...draft, name: "Edited" }, wire), false);
  assert.equal(store.batch.proposedOpportunityName, "Ann Lee — Driver Fitting");
});

test("an existing selection shows no naming state and is never marked saved-new", () => {
  const existing = info({
    state: {
      opportunityResolution: "existing",
      selectedGhlOpportunityId: "opp-1",
      proposedOpportunityName: null,
      fittingDateOverride: null,
    },
  });
  assert.equal(isNamingSaved(buildNamingDraft(existing), existing), false);
  assert.equal(buildNamingDraft(existing).name, "Ann Lee — Golf Fitting — Nov 5, 2026");
});

test("choosing Create New only requires a save until the draft matches the saved state", () => {
  const unsaved = info();
  const draft = buildNamingDraft(unsaved);
  // TrackMan date present, nothing persisted yet: Continue must save first.
  assert.equal(requiresNamingSave(true, draft, unsaved), true);

  const saved = info({
    state: {
      opportunityResolution: "new",
      selectedGhlOpportunityId: null,
      proposedOpportunityName: draft.name,
      fittingDateOverride: null,
    },
  });
  assert.equal(requiresNamingSave(true, draft, saved), false);
  assert.equal(requiresNamingSave(true, { ...draft, name: "Edited" }, saved), true);

  // An existing selection (new not chosen) never requires a naming save.
  assert.equal(requiresNamingSave(false, draft, unsaved), false);
});

test("a prior existing selection does not count as a saved new opportunity", () => {
  const existing = info({
    state: {
      opportunityResolution: "existing",
      selectedGhlOpportunityId: "opp-1",
      proposedOpportunityName: null,
      fittingDateOverride: null,
    },
  });
  assert.equal(requiresNamingSave(true, buildNamingDraft(existing), existing), true);
});
