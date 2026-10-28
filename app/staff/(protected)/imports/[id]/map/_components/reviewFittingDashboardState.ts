import type { SerializedClubSummary } from "./clubSummaryTypes";

export type ClubResultSummary = Pick<
  SerializedClubSummary,
  | "id"
  | "clubName"
  | "tags"
  | "shotCount"
  | "avgCarry"
  | "avgTotal"
  | "avgBallSpeed"
  | "avgClubSpeed"
  | "avgSpinRate"
  | "includeInReport"
>;

export function resolveSelectedClubId(
  selectedClubId: number | null,
  summaries: readonly Pick<SerializedClubSummary, "id">[],
): number | null {
  return selectedClubId !== null &&
    summaries.some((summary) => summary.id === selectedClubId)
    ? selectedClubId
    : null;
}

export function formatClubResultMetric(
  value: number | null,
  decimalPlaces = 1,
): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return decimalPlaces === 0
    ? Math.round(value).toLocaleString()
    : value.toFixed(decimalPlaces);
}
