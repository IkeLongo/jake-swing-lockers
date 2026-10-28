import assert from "node:assert/strict";
import test from "node:test";
import {
  formatClubResultMetric,
  resolveSelectedClubId,
} from "../app/staff/(protected)/imports/[id]/map/_components/reviewFittingDashboardState";

test("selected club remains valid across summary updates", () => {
  assert.equal(resolveSelectedClubId(12, [{ id: 12 }, { id: 18 }]), 12);
  assert.equal(resolveSelectedClubId(12, [{ id: 18 }]), null);
  assert.equal(resolveSelectedClubId(null, [{ id: 12 }]), null);
});

test("club result metrics format null and non-finite values neutrally", () => {
  assert.equal(formatClubResultMetric(null), "—");
  assert.equal(formatClubResultMetric(Number.NaN), "—");
  assert.equal(formatClubResultMetric(123.456), "123.5");
  assert.equal(formatClubResultMetric(7123.6, 0), "7,124");
});
