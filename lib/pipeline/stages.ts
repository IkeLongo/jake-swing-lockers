import type { PipelineStage } from "./types";

/**
 * Maps a GHL opportunity stage ID to a simplified active JL Golf pipeline stage.
 *
 * Active JL Stages:
 *   - Demo Submitted         → "demo"
 *   - Swing Locker Sent      → "locker-sent"
 *   - Locker Opened          → "locker-sent"
 *   - Engaged/In Conversation → "engaged"
 *   - Considering Purchase   → "considering"
 *
 * Excluded / Non-active stages (return null):
 *   - Needs Another Fitting
 *   - Purchased
 *   - Long-Term Nurture
 *   - Closed - No Purchase
 *   - Unrecognized / null / empty stage IDs
 *
 * CRITICAL: Never defaults an unknown stage to "demo".
 */
export function mapGhlStageToJlStage(
  pipelineStageId: string | null | undefined
): PipelineStage | null {
  if (!pipelineStageId || typeof pipelineStageId !== "string") {
    return null;
  }

  const trimmedId = pipelineStageId.trim();
  if (!trimmedId) return null;

  const demoSubmittedId = process.env.GHL_SWINGLOCKER_STAGE_DEMO_SUBMITTED_ID;
  const swingLockerSentId = process.env.GHL_SWINGLOCKER_STAGE_SWING_LOCKER_SENT_ID;
  const lockerOpenedId = process.env.GHL_SWINGLOCKER_STAGE_LOCKER_OPENED_ID;
  const engagedId = process.env.GHL_SWINGLOCKER_STAGE_ENGAGED_ID;
  const consideringPurchaseId = process.env.GHL_SWINGLOCKER_STAGE_CONSIDERING_PURCHASE_ID;

  if (demoSubmittedId && trimmedId === demoSubmittedId) {
    return "demo";
  }
  if (swingLockerSentId && trimmedId === swingLockerSentId) {
    return "locker-sent";
  }
  if (lockerOpenedId && trimmedId === lockerOpenedId) {
    return "locker-sent";
  }
  if (engagedId && trimmedId === engagedId) {
    return "engaged";
  }
  if (consideringPurchaseId && trimmedId === consideringPurchaseId) {
    return "considering";
  }

  // All other stages (including explicit closed/nurture IDs and unknown stages) are excluded.
  return null;
}
