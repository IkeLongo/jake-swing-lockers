import type { FittingVisualizationShot } from "@/lib/imports/fittingVisualizationData";
import {
  filterIncludedVisualizationShots,
  type ClubFilterSelection,
} from "./reviewFittingDashboardState";

export interface GappingPoint {
  shotId: string;
  rowIndex: number;
  carryYd: number;
  // Deterministic vertical offset in [-1, 1] so near-equal carries stay visible.
  jitter: number;
}

export interface GappingClubRow {
  summaryId: number;
  averageCarryYd: number;
  minCarryYd: number;
  maxCarryYd: number;
  points: GappingPoint[];
}

export interface GappingBounds {
  minYd: number;
  maxYd: number;
  ticks: number[];
}

const JITTER_LANES = [0, -0.6, 0.6, -0.3, 0.3] as const;

// Only measured carry creates a point; a missing carry is never treated as 0.
export function buildGappingRows(
  shots: readonly FittingVisualizationShot[],
  selection: ClubFilterSelection,
): { rows: GappingClubRow[]; includedShotCount: number } {
  const includedShots = filterIncludedVisualizationShots(shots, selection);
  const bySummary = new Map<number, Omit<GappingPoint, "jitter">[]>();
  for (const shot of includedShots) {
    const carryYd = shot.measurementData.measurements.carryYd;
    if (typeof carryYd !== "number" || !Number.isFinite(carryYd)) continue;
    const points = bySummary.get(shot.summaryId) ?? [];
    points.push({ shotId: shot.shotId, rowIndex: shot.rowIndex, carryYd });
    bySummary.set(shot.summaryId, points);
  }

  const rows = [...bySummary.entries()].map(([summaryId, rawPoints]) => {
    const sorted = [...rawPoints].sort(
      (left, right) =>
        left.carryYd - right.carryYd || left.rowIndex - right.rowIndex,
    );
    const carries = sorted.map((point) => point.carryYd);
    return {
      summaryId,
      averageCarryYd: carries.reduce((sum, value) => sum + value, 0) / carries.length,
      minCarryYd: carries[0]!,
      maxCarryYd: carries[carries.length - 1]!,
      points: sorted.map((point, index) => ({
        ...point,
        jitter: JITTER_LANES[index % JITTER_LANES.length]!,
      })),
    };
  });

  rows.sort(
    (left, right) =>
      right.averageCarryYd - left.averageCarryYd ||
      left.summaryId - right.summaryId,
  );
  return { rows, includedShotCount: includedShots.length };
}

function niceStep(span: number, targetTickCount: number): number {
  const rough = span / targetTickCount;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

export const MIN_GAPPING_SPAN_YD = 30;

export function computeGappingBounds(rows: readonly GappingClubRow[]): GappingBounds {
  if (rows.length === 0) return { minYd: 0, maxYd: MIN_GAPPING_SPAN_YD, ticks: [0, 10, 20, 30] };

  const rawMin = Math.min(...rows.map((row) => row.minCarryYd));
  const rawMax = Math.max(...rows.map((row) => row.maxCarryYd));
  const padding = Math.max((rawMax - rawMin) * 0.1, 5);
  const step = niceStep(Math.max(rawMax - rawMin + padding * 2, MIN_GAPPING_SPAN_YD), 5);
  let minYd = Math.max(0, Math.floor((rawMin - padding) / step) * step);
  let maxYd = Math.ceil((rawMax + padding) / step) * step;
  if (maxYd - minYd < MIN_GAPPING_SPAN_YD) maxYd = minYd + MIN_GAPPING_SPAN_YD;
  minYd = Math.max(0, minYd);

  const ticks: number[] = [];
  for (let tick = minYd; tick <= maxYd + step / 1e6; tick += step) {
    ticks.push(Math.round(tick * 1e6) / 1e6);
  }
  return { minYd, maxYd, ticks };
}
