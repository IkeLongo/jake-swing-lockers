import assert from "node:assert/strict";
import test from "node:test";
import {
  formatClubResultMetric,
  normalizeClubFilterSelection,
  toggleClubFilterSelection,
} from "../app/staff/(protected)/imports/[id]/map/_components/reviewFittingDashboardState";

test("club filter defaults to all and normalizes stale and complete selections", () => {
  assert.equal(normalizeClubFilterSelection(null, [12, 18]), null);
  assert.deepEqual(
    [...normalizeClubFilterSelection(new Set([12, 99]), [12, 18])!],
    [12],
  );
  assert.equal(normalizeClubFilterSelection(new Set([12]), [12]), null);
  assert.equal(normalizeClubFilterSelection(new Set([12, 18]), [12, 18]), null);
});

test("All Clubs resets partial multi-club selections", () => {
  assert.equal(toggleClubFilterSelection(new Set([12, 18]), [12, 18, 24], null), null);
});

test("club result metrics format null and non-finite values neutrally", () => {
  assert.equal(formatClubResultMetric(null), "—");
  assert.equal(formatClubResultMetric(Number.NaN), "—");
  assert.equal(formatClubResultMetric(123.456), "123.5");
  assert.equal(formatClubResultMetric(7123.6, 0), "7,124");
});
