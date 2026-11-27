import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ClubSummarySection } from "@/app/staff/(protected)/imports/[id]/map/_components/ClubSummarySection";
import type { SerializedClubSummary } from "@/app/staff/(protected)/imports/[id]/map/_components/clubSummaryTypes";

const summary: SerializedClubSummary = {
  id: 2, importBatchId: 1, originalClubName: "Driver", clubName: "Driver",
  tags: [], shotCount: 1, avgClubSpeed: null, avgBallSpeed: null,
  avgSpinRate: null, avgMaxHeight: null, avgCarry: 200, avgTotal: null,
  validClubSpeedCount: 0, validBallSpeedCount: 0, validSpinRateCount: 0,
  validMaxHeightCount: 0, validCarryCount: 1, validTotalCount: 0,
  isManuallyEdited: false, includeInReport: true, availableForPurchase: false,
  estimatedPrice: null, currentSummaryId: null,
};

function render(sessionStatus: string, parserMode: string, needsRefinalization: boolean) {
  return renderToStaticMarkup(createElement(
    AppRouterContext.Provider,
    { value: { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} } },
    createElement(ClubSummarySection, {
      batchId: 1, initialSummaries: [summary], parserMode, sessionId: 7,
      sessionStatus, needsRefinalization, hideFinalize: true,
    }),
  ));
}

test("finalized TrackMan fittings expose pending and up-to-date publication states beneath results", () => {
  const clean = render("finalized", "trackman-result", false);
  assert.match(clean, /The Swing Locker is up to date/);
  assert.match(clean, /<button[^>]*disabled=""[^>]*>Re-finalize Fitting<\/button>/);
  assert.ok(clean.indexOf("Club Results") < clean.indexOf("Re-finalize Fitting"));

  const pending = render("finalized", "trackman-result", true);
  assert.match(pending, /Changes are pending/);
  assert.match(pending, /<button(?![^>]* disabled="")[^>]*>Re-finalize Fitting<\/button>/);
  assert.doesNotMatch(render("reviewing", "trackman-result", true), /Re-finalize Fitting/);
  assert.doesNotMatch(render("finalized", "generic", true), /Re-finalize Fitting/);
});
