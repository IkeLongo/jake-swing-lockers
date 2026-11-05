import { after, test } from "node:test";
import assert from "node:assert/strict";
import {
  getOpportunityStateAfterCustomerChange,
  hasGhlContactId,
  isOpportunityResolutionMutable,
  parseOpportunityResolution,
} from "@/lib/imports/opportunity-resolution";
import { hasSameCustomerIdentity } from "@/lib/imports/customer-resolution";

const originalGhlEnvironment = {
  GHL_SWINGLOCKER_PRIVATE_TOKEN:
    process.env.GHL_SWINGLOCKER_PRIVATE_TOKEN,
  GHL_SWINGLOCKER_LOCATION_ID: process.env.GHL_SWINGLOCKER_LOCATION_ID,
  GHL_SWINGLOCKER_PIPELINE_ID: process.env.GHL_SWINGLOCKER_PIPELINE_ID,
};

after(() => {
  for (const [key, value] of Object.entries(originalGhlEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const existingCustomer = {
  customerResolution: "existing" as const,
  selectedGolfClientId: 17,
  proposedFirstName: null,
  proposedLastName: null,
  proposedEmail: null,
  proposedPhone: null,
};

function mutableBatch(overrides: Record<string, unknown> = {}) {
  return {
    ...existingCustomer,
    parserMode: "trackman-result",
    demoSessionId: null,
    ...overrides,
  };
}

const NO_NAMING = { proposedOpportunityName: null, fittingDateOverride: null };

test("opportunity resolution parser handles unresolved, existing, and create-new states", () => {
  assert.deepEqual(parseOpportunityResolution({ resolution: null }), {
    success: true,
    state: {
      opportunityResolution: null,
      selectedGhlOpportunityId: null,
      ...NO_NAMING,
    },
  });
  assert.deepEqual(
    parseOpportunityResolution({
      resolution: "existing",
      selectedGhlOpportunityId: " opp-123 ",
    }),
    {
      success: true,
      state: {
        opportunityResolution: "existing",
        selectedGhlOpportunityId: "opp-123",
        ...NO_NAMING,
      },
    },
  );
  assert.deepEqual(parseOpportunityResolution({ resolution: "new" }), {
    success: true,
    state: {
      opportunityResolution: "new",
      selectedGhlOpportunityId: null,
      ...NO_NAMING,
    },
  });
});

test("opportunity resolution parser validates the custom name and fitting date", () => {
  const ok = parseOpportunityResolution({
    resolution: "new",
    opportunityName: "  Ann Lee — Driver Fitting — Nov 5, 2026 ",
    fittingDate: "2026-11-05",
  });
  assert.deepEqual(ok, {
    success: true,
    state: {
      opportunityResolution: "new",
      selectedGhlOpportunityId: null,
      proposedOpportunityName: "Ann Lee — Driver Fitting — Nov 5, 2026",
      fittingDateOverride: new Date("2026-11-05T00:00:00.000Z"),
    },
  });
  for (const body of [
    { resolution: "new", opportunityName: "   " },
    { resolution: "new", opportunityName: 5 },
    { resolution: "new", opportunityName: "x".repeat(256) },
    { resolution: "new", opportunityName: "bad\nname" },
    { resolution: "new", fittingDate: "2026-02-30" },
    { resolution: "new", fittingDate: "11/05/2026" },
    { resolution: "existing", selectedGhlOpportunityId: "o", opportunityName: "Rename" },
    { resolution: null, fittingDate: "2026-11-05" },
  ]) {
    assert.equal(parseOpportunityResolution(body).success, false, JSON.stringify(body));
  }
});

test("opportunity resolution parser rejects invalid state combinations", () => {
  for (const body of [
    { resolution: "existing" },
    { resolution: "existing", selectedGhlOpportunityId: " " },
    { resolution: "new", selectedGhlOpportunityId: "opp-123" },
    { resolution: null, selectedGhlOpportunityId: "opp-123" },
    { resolution: "unknown" },
  ]) {
    assert.equal(parseOpportunityResolution(body).success, false);
  }
});

test("existing-opportunity choice is unavailable without a GHL contact", () => {
  assert.equal(hasGhlContactId(null), false);
  assert.equal(hasGhlContactId("  "), false);
  assert.equal(hasGhlContactId("ghl-contact-1"), true);
  assert.deepEqual(parseOpportunityResolution({ resolution: "new" }), {
    success: true,
    state: {
      opportunityResolution: "new",
      selectedGhlOpportunityId: null,
      ...NO_NAMING,
    },
  });
});

test("staged decisions are mutable only for unlinked TrackMan batches with a resolved customer", () => {
  assert.equal(isOpportunityResolutionMutable(mutableBatch()), true);
  assert.equal(
    isOpportunityResolutionMutable(mutableBatch({ demoSessionId: 45 })),
    false,
  );
  assert.equal(
    isOpportunityResolutionMutable(mutableBatch({ parserMode: "generic" })),
    false,
  );
  assert.equal(
    isOpportunityResolutionMutable(
      mutableBatch({ customerResolution: null, selectedGolfClientId: null }),
    ),
    false,
  );
});

test("customer identity comparison preserves the same existing or proposed customer", () => {
  const stagedOpportunity = {
    opportunityResolution: "existing" as const,
    selectedGhlOpportunityId: "opp-1",
    ...NO_NAMING,
  };
  assert.equal(
    hasSameCustomerIdentity(existingCustomer, { ...existingCustomer }),
    true,
  );
  assert.deepEqual(
    getOpportunityStateAfterCustomerChange(
      existingCustomer,
      { ...existingCustomer },
      stagedOpportunity,
    ),
    stagedOpportunity,
  );
  assert.deepEqual(
    getOpportunityStateAfterCustomerChange(
      existingCustomer,
      { ...existingCustomer, selectedGolfClientId: 18 },
      stagedOpportunity,
    ),
    {
      opportunityResolution: null,
      selectedGhlOpportunityId: null,
      ...NO_NAMING,
    },
  );
  assert.equal(
    hasSameCustomerIdentity(existingCustomer, {
      ...existingCustomer,
      selectedGolfClientId: 18,
    }),
    false,
  );

  const proposed = {
    customerResolution: "new" as const,
    selectedGolfClientId: null,
    proposedFirstName: "Max",
    proposedLastName: "Tucker",
    proposedEmail: "max@example.com",
    proposedPhone: null,
  };
  assert.equal(hasSameCustomerIdentity(proposed, { ...proposed }), true);
  assert.equal(
    hasSameCustomerIdentity(proposed, {
      ...proposed,
      proposedEmail: "other@example.com",
    }),
    false,
  );
});

test("GHL opportunity validation checks contact, location, pipeline, and open status", async () => {
  const previousFetch = globalThis.fetch;
  process.env.GHL_SWINGLOCKER_PRIVATE_TOKEN = "test-token";
  process.env.GHL_SWINGLOCKER_LOCATION_ID = "location-1";
  process.env.GHL_SWINGLOCKER_PIPELINE_ID = "pipeline-1";

  try {
    const opportunity = {
      id: "opp-1",
      name: "Fitting",
      contactId: "contact-1",
      locationId: "location-1",
      pipelineId: "pipeline-1",
      pipelineStageId: "stage-1",
      status: "open",
    };
    globalThis.fetch = (async () =>
      Response.json({ opportunity })) as typeof fetch;

    const { validateOpportunitySelection } = await import(
      "@/lib/ghl/opportunities"
    );
    assert.deepEqual(
      await validateOpportunitySelection("opp-1", "contact-1"),
      { valid: true, opportunity },
    );

    for (const mismatch of [
      { ...opportunity, contactId: "other-contact" },
      { ...opportunity, locationId: "other-location" },
      { ...opportunity, pipelineId: "other-pipeline" },
      { ...opportunity, status: "won" },
    ]) {
      globalThis.fetch = (async () =>
        Response.json({ opportunity: mismatch })) as typeof fetch;
      const result = await validateOpportunitySelection("opp-1", "contact-1");
      assert.deepEqual(result, { valid: false, reason: "not_relevant" });
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("GHL validation distinguishes not-found from service failures", async () => {
  const previousFetch = globalThis.fetch;
  process.env.GHL_SWINGLOCKER_PRIVATE_TOKEN = "test-token";
  process.env.GHL_SWINGLOCKER_LOCATION_ID = "location-1";
  process.env.GHL_SWINGLOCKER_PIPELINE_ID = "pipeline-1";

  try {
    globalThis.fetch = (async () =>
      new Response("Not found", { status: 404 })) as typeof fetch;
    const { validateOpportunitySelection } = await import(
      "@/lib/ghl/opportunities"
    );
    assert.deepEqual(
      await validateOpportunitySelection("missing", "contact-1"),
      { valid: false, reason: "not_found" },
    );

    globalThis.fetch = (async () =>
      new Response("Unavailable", { status: 503 })) as typeof fetch;
    await assert.rejects(
      validateOpportunitySelection("opp-1", "contact-1"),
      /GHL API error: 503/,
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("listing opportunities returns the candidates without selecting one", async () => {
  const previousFetch = globalThis.fetch;
  process.env.GHL_SWINGLOCKER_PRIVATE_TOKEN = "test-token";
  process.env.GHL_SWINGLOCKER_LOCATION_ID = "location-1";
  process.env.GHL_SWINGLOCKER_PIPELINE_ID = "pipeline-1";

  try {
    const opportunities = [
      {
        id: "opp-1",
        name: "Pursuit one",
        contactId: "contact-1",
        locationId: "location-1",
        pipelineId: "pipeline-1",
        pipelineStageId: "stage-1",
        status: "open",
      },
      {
        id: "opp-2",
        name: "Pursuit two",
        contactId: "contact-1",
        locationId: "location-1",
        pipelineId: "pipeline-1",
        pipelineStageId: "stage-2",
        status: "open",
      },
    ];
    globalThis.fetch = (async () =>
      Response.json({ opportunities, total: opportunities.length })) as typeof fetch;
    const { listOpenOpportunitiesForContact } = await import(
      "@/lib/ghl/opportunities"
    );
    const result = await listOpenOpportunitiesForContact("contact-1");
    assert.deepEqual(result, opportunities);
    assert.equal(result.length, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
