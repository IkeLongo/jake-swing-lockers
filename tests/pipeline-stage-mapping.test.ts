import test from "node:test";
import assert from "node:assert/strict";
import { mapGhlStageToJlStage } from "@/lib/pipeline/stages";

test("GHL to JL stage mapper maps active stages correctly", () => {
  // Set test environment variables
  process.env.GHL_SWINGLOCKER_STAGE_DEMO_SUBMITTED_ID = "stage-demo-sub";
  process.env.GHL_SWINGLOCKER_STAGE_SWING_LOCKER_SENT_ID = "stage-locker-sent";
  process.env.GHL_SWINGLOCKER_STAGE_LOCKER_OPENED_ID = "stage-locker-opened";
  process.env.GHL_SWINGLOCKER_STAGE_ENGAGED_ID = "stage-engaged";
  process.env.GHL_SWINGLOCKER_STAGE_CONSIDERING_PURCHASE_ID = "stage-considering";

  // Excluded / closed stages
  process.env.GHL_SWINGLOCKER_STAGE_PURCHASED_ID = "stage-purchased";
  process.env.GHL_SWINGLOCKER_STAGE_NEEDS_ANOTHER_FITTING_ID = "stage-needs-fitting";
  process.env.GHL_SWINGLOCKER_STAGE_LONG_TERM_NURTURE_ID = "stage-nurture";
  process.env.GHL_SWINGLOCKER_STAGE_CLOSED_NO_PURCHASE_ID = "stage-closed-no-purchase";

  // Active stage mappings
  assert.equal(mapGhlStageToJlStage("stage-demo-sub"), "demo");
  assert.equal(mapGhlStageToJlStage("stage-locker-sent"), "locker-sent");
  assert.equal(mapGhlStageToJlStage("stage-locker-opened"), "locker-sent");
  assert.equal(mapGhlStageToJlStage("stage-engaged"), "engaged");
  assert.equal(mapGhlStageToJlStage("stage-considering"), "considering");

  // Non-active / closed stages must return null (excluded)
  assert.equal(mapGhlStageToJlStage("stage-purchased"), null);
  assert.equal(mapGhlStageToJlStage("stage-needs-fitting"), null);
  assert.equal(mapGhlStageToJlStage("stage-nurture"), null);
  assert.equal(mapGhlStageToJlStage("stage-closed-no-purchase"), null);

  // Unknown / unmapped stages must return null (never default to demo)
  assert.equal(mapGhlStageToJlStage("unknown-random-stage-id"), null);
  assert.equal(mapGhlStageToJlStage(""), null);
  assert.equal(mapGhlStageToJlStage(null), null);
  assert.equal(mapGhlStageToJlStage(undefined), null);
});
