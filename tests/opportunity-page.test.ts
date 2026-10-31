import assert from "node:assert/strict";
import test from "node:test";
import {
  canContinueFromOpportunity,
  formatOpportunityMeta,
  getContinueHint,
  getOpportunityChoiceBody,
  getOpportunityPageRedirect,
  isSameChoice,
  normalizeOpportunityCreatedAt,
} from "../lib/imports/opportunity-page";

test("createdAt is normalized and never invented", () => {
  assert.equal(
    normalizeOpportunityCreatedAt("2026-05-08T22:39:05.154Z"),
    "2026-05-08T22:39:05.154Z",
  );
  assert.equal(normalizeOpportunityCreatedAt(undefined), null);
  assert.equal(normalizeOpportunityCreatedAt(""), null);
  assert.equal(normalizeOpportunityCreatedAt("not a date"), null);
  assert.equal(normalizeOpportunityCreatedAt(12345), null);
});

test("card meta shows creation date and status, or status alone", () => {
  assert.equal(
    formatOpportunityMeta({ createdAt: "2026-10-31T17:00:00.000Z", status: "open" }),
    "Oct 31, 2026 · open",
  );
  assert.equal(formatOpportunityMeta({ createdAt: null, status: "open" }), "open");
  assert.equal(formatOpportunityMeta({ createdAt: null, status: null }), "open");
});

const opportunities = [
  { id: "opp-1", name: "Driver fitting", pipelineStageId: "s1", status: "open", createdAt: "2026-10-31T17:00:00.000Z" },
];
const unresolved = { opportunityResolution: null, selectedGhlOpportunityId: null } as const;

const batch = {
  id: 7,
  parserMode: "trackman-result",
  demoSessionId: null,
  customerResolution: "existing",
  selectedGolfClientId: 3,
  proposedFirstName: null,
  proposedLastName: null,
  proposedEmail: null,
  proposedPhone: null,
};

test("page redirects away when not eligible", () => {
  assert.equal(getOpportunityPageRedirect(batch), null);
  assert.equal(
    getOpportunityPageRedirect({ ...batch, demoSessionId: 1 }),
    "/staff/imports/7/map",
  );
  assert.equal(
    getOpportunityPageRedirect({ ...batch, parserMode: "other" }),
    "/staff/imports/7",
  );
  assert.equal(
    getOpportunityPageRedirect({ ...batch, customerResolution: null, selectedGolfClientId: null }),
    "/staff/imports/7/customer",
  );
});

test("unresolved decision blocks Continue with a hint", () => {
  const response = { state: unresolved, opportunities };
  assert.equal(canContinueFromOpportunity(response), false);
  assert.match(getContinueHint(response) ?? "", /Choose an opportunity/);
});

test("unresolved stays unresolved when there are no opportunities", () => {
  const response = { state: unresolved, opportunities: [] };
  assert.equal(canContinueFromOpportunity(response), false);
});

test("create-new allows Continue even with no opportunities", () => {
  const response = {
    state: { opportunityResolution: "new", selectedGhlOpportunityId: null } as const,
    opportunities: [],
  };
  assert.equal(canContinueFromOpportunity(response), true);
  assert.equal(getContinueHint(response), null);
});

test("existing selection allows Continue only while still an open candidate", () => {
  const state = { opportunityResolution: "existing", selectedGhlOpportunityId: "opp-1" } as const;
  assert.equal(canContinueFromOpportunity({ state, opportunities }), true);
  const stale = { state, opportunities: [] };
  assert.equal(canContinueFromOpportunity(stale), false);
  assert.match(getContinueHint(stale) ?? "", /no longer open/);
});

test("PUT bodies match the API contract", () => {
  assert.deepEqual(
    getOpportunityChoiceBody({ resolution: "existing", selectedGhlOpportunityId: "opp-1" }),
    { resolution: "existing", selectedGhlOpportunityId: "opp-1" },
  );
  assert.deepEqual(getOpportunityChoiceBody({ resolution: "new" }), { resolution: "new" });
  assert.deepEqual(getOpportunityChoiceBody({ resolution: null }), { resolution: null });
});

test("isSameChoice detects redundant selections", () => {
  const state = { opportunityResolution: "existing", selectedGhlOpportunityId: "opp-1" } as const;
  assert.equal(isSameChoice(state, { resolution: "existing", selectedGhlOpportunityId: "opp-1" }), true);
  assert.equal(isSameChoice(state, { resolution: "existing", selectedGhlOpportunityId: "opp-2" }), false);
  assert.equal(isSameChoice(state, { resolution: "new" }), false);
  assert.equal(isSameChoice(unresolved, { resolution: null }), true);
});
