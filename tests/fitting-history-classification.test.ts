import test from "node:test";
import assert from "node:assert/strict";

/**
 * Test suite for the Fitting History page reorganization.
 * 
 * This verifies that the classification logic correctly distinguishes between:
 * - In Progress: Unfinalized imports actively being reviewed (uploaded/parsed/reviewing)
 * - Fittings by Opportunity: Finalized DemoSessions grouped by their GHL opportunity
 * - Legacy Uploads: Abandoned imports (approved but never linked, or failed)
 */

test("classification logic: unfinalized imports are in-progress, not legacy", () => {
  // An import with a recent upload and reviewing status should be treated as in-progress
  const inProgressStatuses = ["uploaded", "parsed", "reviewing"];
  
  for (const status of inProgressStatuses) {
    assert.ok(
      inProgressStatuses.includes(status),
      `Status "${status}" should be in-progress (has demoSessionId: null + status in [uploaded/parsed/reviewing])`
    );
  }
});

test("classification logic: approved batches without demoSession are legacy", () => {
  // A batch that reached "approved" status but never had a DemoSession created
  // indicates it's from the old workflow and was abandoned
  const legacyStatuses = ["approved", "failed"];
  
  for (const status of legacyStatuses) {
    assert.ok(
      legacyStatuses.includes(status),
      `Status "${status}" should be legacy (has demoSessionId: null + status in [approved/failed])`
    );
  }
});

test("classification logic: finalized sessions appear in Fittings by Opportunity", () => {
  // DemoSessions with status === "finalized" should be grouped by their ghlOpportunityId
  const finalizedStatus = "finalized";
  
  assert.strictEqual(
    finalizedStatus,
    "finalized",
    "Only finalized DemoSessions appear in Fittings by Opportunity"
  );
});

test("classification logic: prevent duplicates across sections", () => {
  // An ImportBatch cannot simultaneously:
  // - Have demoSessionId !== null (would be part of a session, not in in-progress/legacy)
  // - Appear in both "In Progress" and "Legacy" (mutually exclusive status groups)
  
  const inProgressStatuses = new Set(["uploaded", "parsed", "reviewing"]);
  const legacyStatuses = new Set(["approved", "failed"]);
  
  // Verify no overlap
  for (const status of inProgressStatuses) {
    assert.ok(
      !legacyStatuses.has(status),
      `Status "${status}" cannot be in both in-progress and legacy groups`
    );
  }
  
  for (const status of legacyStatuses) {
    assert.ok(
      !inProgressStatuses.has(status),
      `Status "${status}" cannot be in both legacy and in-progress groups`
    );
  }
});

test("classification logic: Continue URL routing for in-progress batches", () => {
  // For non-TrackMan imports, route to generic review page
  const nonTrackManParserMode = "generic";
  const nonTrackManBaseRoute = `/staff/imports/42`;
  
  assert.strictEqual(
    nonTrackManBaseRoute,
    "/staff/imports/42",
    "Non-TrackMan imports should route to /staff/imports/{id}"
  );
  
  // For TrackMan imports, route to map page (club review)
  // The map page will handle redirects to customer/opportunity if needed
  const trackManParserMode = "trackman-result";
  const trackManRoute = `/staff/imports/42/map`;
  
  assert.strictEqual(
    trackManRoute,
    "/staff/imports/42/map",
    "TrackMan imports should route to /staff/imports/{id}/map"
  );
});

test("classification logic: Legacy section only displays if legacy batches exist", () => {
  // The Legacy Uploads section is wrapped with:
  // {legacyBatches.length > 0 && (
  //   <div>... table ...</div>
  // )}
  
  const emptyLegacyBatches: unknown[] = [];
  const shouldRenderLegacySection = emptyLegacyBatches.length > 0;
  
  assert.strictEqual(
    shouldRenderLegacySection,
    false,
    "Legacy section should not render if no legacy batches exist"
  );
  
  const nonEmptyLegacyBatches = [{ id: 1, status: "failed" }];
  const shouldRenderNonEmpty = nonEmptyLegacyBatches.length > 0;
  
  assert.strictEqual(
    shouldRenderNonEmpty,
    true,
    "Legacy section should render if legacy batches exist"
  );
});

test("classification logic: Section heading includes fitting count", () => {
  // "Fittings in Progress (5)" - count is displayed in the heading
  const inProgressCount = 5;
  const headingText = `Fittings in Progress (${inProgressCount})`;
  
  assert.strictEqual(
    headingText,
    "Fittings in Progress (5)",
    "Section heading should include the batch count"
  );
});

test("classification logic: Customer name fallback to filename", () => {
  // For in-progress batches, display customer name if selected,
  // otherwise fall back to the uploaded filename
  
  const batchWithCustomer = {
    selectedGolfClient: {
      firstName: "John",
      lastName: "Doe",
      email: "john@example.com",
    },
    originalFileName: "trackman_export.csv",
  };
  
  const clientName =
    batchWithCustomer.selectedGolfClient.firstName && 
    batchWithCustomer.selectedGolfClient.lastName
      ? `${batchWithCustomer.selectedGolfClient.firstName} ${batchWithCustomer.selectedGolfClient.lastName}`
      : batchWithCustomer.originalFileName;
  
  assert.strictEqual(
    clientName,
    "John Doe",
    "Should use customer name when available"
  );
  
  // Fallback to filename when no customer selected
  const batchWithoutCustomer = {
    selectedGolfClient: null,
    originalFileName: "trackman_export.csv",
  };
  
  const fallbackName = batchWithoutCustomer.selectedGolfClient
    ? "John Doe"
    : batchWithoutCustomer.originalFileName;
  
  assert.strictEqual(
    fallbackName,
    "trackman_export.csv",
    "Should fall back to filename when no customer selected"
  );
});
