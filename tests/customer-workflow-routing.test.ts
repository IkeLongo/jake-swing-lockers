import test from "node:test";
import assert from "node:assert/strict";
import {
  getCustomerPageRedirect,
  getReviewPageRedirect,
  hasPersistedCustomerResolution,
  type ImportCustomerWorkflowState,
} from "@/lib/imports/customer-workflow-routing";

function createBatch(
  overrides: Partial<ImportCustomerWorkflowState> = {},
): ImportCustomerWorkflowState {
  return {
    id: 42,
    parserMode: "trackman-result",
    demoSessionId: null,
    customerResolution: null,
    selectedGolfClientId: null,
    proposedFirstName: null,
    proposedLastName: null,
    proposedEmail: null,
    proposedPhone: null,
    ...overrides,
  };
}

test("unresolved staged TrackMan imports redirect from review to customer step", () => {
  assert.equal(
    getReviewPageRedirect(createBatch(), null),
    "/staff/imports/42/customer",
  );
});

test("a resolved customer without a current GHL approval redirects to the customer step", () => {
  const resolved = createBatch({
    customerResolution: "existing",
    selectedGolfClientId: 9,
  });
  assert.equal(getReviewPageRedirect(resolved, null), "/staff/imports/42/customer");
  assert.equal(getReviewPageRedirect(resolved, "existing"), null);
  assert.equal(getReviewPageRedirect(resolved, "new"), null);
});

test("persisted existing and new customer resolutions can reach review", () => {
  assert.equal(
    getReviewPageRedirect(
      createBatch({
        customerResolution: "existing",
        selectedGolfClientId: 9,
      }),
      "existing",
    ),
    null,
  );
  assert.equal(
    getReviewPageRedirect(
      createBatch({
        customerResolution: "new",
        proposedFirstName: "Max",
        proposedEmail: "max@example.com",
      }),
      "new",
    ),
    null,
  );
});

test("incomplete staged resolutions are not considered persisted", () => {
  assert.equal(
    hasPersistedCustomerResolution(
      createBatch({
        customerResolution: "existing",
        selectedGolfClientId: null,
      }),
    ),
    false,
  );
  assert.equal(
    hasPersistedCustomerResolution(
      createBatch({
        customerResolution: "new",
        proposedFirstName: " ",
      }),
    ),
    false,
  );
});

test("linked DemoSession imports bypass the staged customer requirement", () => {
  const linkedBatch = createBatch({
    demoSessionId: 10,
    customerResolution: null,
  });

  assert.equal(getReviewPageRedirect(linkedBatch, null), null);
  assert.equal(
    getCustomerPageRedirect(linkedBatch),
    "/staff/imports/42/map",
  );
});

test("customer page redirects non-TrackMan imports to their regular review page", () => {
  assert.equal(
    getCustomerPageRedirect(createBatch({ parserMode: "generic" })),
    "/staff/imports/42",
  );
});
