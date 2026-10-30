import type { SerializedClubSummary } from "./clubSummaryTypes";
import type { FittingVisualizationShot } from "@/lib/imports/fittingVisualizationData";
import type { NormalizedGolfShotMeasurements } from "@/lib/imports/golfShotMeasurements";
import { buildClubFlightModel } from "@/lib/golf/flight/modeledFlight";
import { toModeledShotInput } from "@/lib/golf/flight/shotReviewFlightInput";
import type { ModeledShotFlight } from "@/lib/golf/flight/types";

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

export type ClubFilterSelection = ReadonlySet<number> | null;

export interface ClubComparisonMetricRow {
  summaryId: number;
  clubName: string;
  color: string | undefined;
  avgCarry: number | null;
  avgTotal: number | null;
  avgBallSpeed: number | null;
  avgClubSpeed: number | null;
  avgSpinRate: number | null;
}

export function buildClubComparisonMetricRows(
  summaries: readonly Pick<
    SerializedClubSummary,
    | "id"
    | "clubName"
    | "avgCarry"
    | "avgTotal"
    | "avgBallSpeed"
    | "avgClubSpeed"
    | "avgSpinRate"
  >[],
  comparisonSummaryIds: readonly number[],
  colorsBySummaryId: ReadonlyMap<number, string>,
): ClubComparisonMetricRow[] {
  const uniqueIds = [...new Set(comparisonSummaryIds)];
  if (uniqueIds.length < 2) return [];

  const summariesById = new Map(summaries.map((summary) => [summary.id, summary]));
  return uniqueIds.flatMap((summaryId) => {
    const summary = summariesById.get(summaryId);
    if (!summary) return [];
    return [{
      summaryId,
      clubName: summary.clubName,
      color: colorsBySummaryId.get(summaryId),
      avgCarry: summary.avgCarry,
      avgTotal: summary.avgTotal,
      avgBallSpeed: summary.avgBallSpeed,
      avgClubSpeed: summary.avgClubSpeed,
      avgSpinRate: summary.avgSpinRate,
    }];
  });
}

export function normalizeClubFilterSelection(
  selection: ClubFilterSelection,
  summaryIds: readonly number[],
): ClubFilterSelection {
  if (selection === null) return null;

  const availableIds = new Set(summaryIds);
  const normalized = new Set(
    [...selection].filter((summaryId) => availableIds.has(summaryId)),
  );
  return normalized.size === 0 || normalized.size === availableIds.size
    ? null
    : normalized;
}

export function toggleClubFilterSelection(
  selection: ClubFilterSelection,
  summaryIds: readonly number[],
  summaryId: number | null,
): ClubFilterSelection {
  if (summaryId === null) return null;

  const normalized = normalizeClubFilterSelection(selection, summaryIds);
  if (normalized === null) {
    return summaryIds.length <= 1
      ? null
      : new Set([summaryId]);
  }

  const next = new Set(normalized);
  if (next.has(summaryId)) next.delete(summaryId);
  else next.add(summaryId);
  return normalizeClubFilterSelection(next, summaryIds);
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

const normalizedMeasurementKeys = [
  "clubSpeedMph",
  "ballSpeedMph",
  "launchAngleDeg",
  "launchDirectionDeg",
  "spinRateRpm",
  "spinAxisDeg",
  "apexDistanceYd",
  "apexHeightYd",
  "apexSideYd",
  "carryYd",
  "carrySideYd",
  "landingAngleDeg",
  "carryBallSpeedMph",
  "hangTimeS",
  "totalYd",
  "totalSideYd",
  "attackAngleDeg",
  "clubPathDeg",
  "faceAngleDeg",
  "dynamicLoftDeg",
  "smashFactor",
] as const satisfies readonly (keyof NormalizedGolfShotMeasurements)[];

export function isFittingVisualizationData(
  value: unknown,
): value is { shots: FittingVisualizationShot[] } {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Array.isArray((value as Record<string, unknown>).shots)
  ) {
    return false;
  }

  return (value as { shots: unknown[] }).shots.every((shot) => {
    if (
      shot === null ||
      typeof shot !== "object" ||
      Array.isArray(shot)
    ) {
      return false;
    }

    const record = shot as Record<string, unknown>;
    const measurementData = record.measurementData;
    const measurementRecord =
      measurementData !== null &&
      typeof measurementData === "object" &&
      !Array.isArray(measurementData)
        ? (measurementData as Record<string, unknown>)
        : null;
    if (
      typeof record.shotId !== "string" ||
      !/^[1-9]\d*$/.test(record.shotId) ||
      !Number.isSafeInteger(Number(record.shotId)) ||
      typeof record.rowIndex !== "number" ||
      !Number.isSafeInteger(record.rowIndex) ||
      record.rowIndex < 0 ||
      typeof record.summaryId !== "number" ||
      !Number.isSafeInteger(record.summaryId) ||
      record.summaryId <= 0 ||
      typeof record.clubName !== "string" ||
      !Array.isArray(record.tags) ||
      !record.tags.every((tag) => typeof tag === "string") ||
      typeof record.included !== "boolean" ||
      measurementRecord === null ||
      (measurementRecord.contractVersion !== null &&
        typeof measurementRecord.contractVersion !== "number") ||
      (measurementRecord.sourceProvider !== null &&
        typeof measurementRecord.sourceProvider !== "string") ||
      typeof measurementRecord.hasNormalizedMeasurements !== "boolean" ||
      (measurementRecord.lateralSignConvention !== null &&
        typeof measurementRecord.lateralSignConvention !== "string")
    ) {
      return false;
    }

    const measurements = measurementRecord.measurements;
    if (
      measurements === null ||
      typeof measurements !== "object" ||
      Array.isArray(measurements)
    ) {
      return false;
    }
    const normalized = measurements as Record<string, unknown>;
    return normalizedMeasurementKeys.every(
      (key) =>
        normalized[key] === null ||
        (typeof normalized[key] === "number" &&
          Number.isFinite(normalized[key])),
    );
  });
}

export function filterIncludedVisualizationShots(
  shots: readonly FittingVisualizationShot[],
  selectedSummaryIds: ClubFilterSelection,
): FittingVisualizationShot[] {
  return shots.filter(
    (shot) =>
      shot.included &&
      (selectedSummaryIds === null ||
        selectedSummaryIds.has(shot.summaryId)),
  );
}

export function buildFittingFlightModel(
  shots: readonly FittingVisualizationShot[],
  selectedSummaryIds: ClubFilterSelection,
): {
  shots: FittingVisualizationShot[];
  flights: ModeledShotFlight[];
} {
  const selectedShots = filterIncludedVisualizationShots(
    shots,
    selectedSummaryIds,
  );
  const model = buildClubFlightModel(
    selectedShots.map((shot) =>
      toModeledShotInput({
        id: shot.shotId,
        rowIndex: shot.rowIndex,
        included: shot.included,
        clubSummaryId: shot.summaryId,
        measurementData: shot.measurementData,
      }),
    ),
    { includedOnly: true },
  );
  return { shots: selectedShots, flights: model.flights };
}

export function buildFittingClubLegend(
  flights: readonly ModeledShotFlight[],
  summaries: readonly Pick<SerializedClubSummary, "id">[],
  colorsBySummaryId: ReadonlyMap<number, string>,
  namesBySummaryId: ReadonlyMap<number, string>,
): { summaryId: number; label: string; color: string }[] {
  const renderableIds = new Set(
    flights.flatMap((flight) =>
      flight.status === "modeled" && flight.clubSummaryId !== undefined
        ? [flight.clubSummaryId]
        : [],
    ),
  );
  return summaries.flatMap((summary) => {
    const color = colorsBySummaryId.get(summary.id);
    return renderableIds.has(summary.id) && color
      ? [{
          summaryId: summary.id,
          label: namesBySummaryId.get(summary.id) ?? "Unknown Club",
          color,
        }]
      : [];
  });
}

export function createClubColorMap(
  summaryIds: readonly number[],
  palette: readonly string[],
): ReadonlyMap<number, string> {
  if (palette.length === 0) {
    throw new RangeError("Club color palette must contain at least one color.");
  }

  const sortedIds = [...new Set(summaryIds)].sort((left, right) => left - right);
  return new Map(
    sortedIds.map((summaryId, index) => [
      summaryId,
      palette[index % palette.length]!,
    ]),
  );
}
