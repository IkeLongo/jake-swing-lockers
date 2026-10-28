import type { FittingVisualizationShot } from "@/lib/imports/fittingVisualizationData";
import {
  filterIncludedVisualizationShots,
  type ClubFilterSelection,
} from "./reviewFittingDashboardState";

export interface DispersionPoint {
  shotId: string;
  rowIndex: number;
  summaryId: number;
  carryYd: number;
  carrySideYd: number;
}

export interface ClubDispersionAverage {
  summaryId: number;
  carryYd: number;
  carrySideYd: number;
  shotCount: number;
}

export interface DispersionBounds {
  minLateralYd: number;
  maxLateralYd: number;
  minCarryYd: number;
  maxCarryYd: number;
  lateralTicks: number[];
  carryTicks: number[];
}

export const MIN_LATERAL_HALF_RANGE_YD = 15;
export const MIN_CARRY_SPAN_YD = 40;

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Only measured carry and carry side create a point; a missing lateral value is
// never replaced with zero.
export function buildDispersionPoints(
  shots: readonly FittingVisualizationShot[],
  selection: ClubFilterSelection,
): { points: DispersionPoint[]; includedShotCount: number } {
  const includedShots = filterIncludedVisualizationShots(shots, selection);
  const points = includedShots.flatMap((shot) => {
    const carryYd = finiteOrNull(shot.measurementData.measurements.carryYd);
    const carrySideYd = finiteOrNull(
      shot.measurementData.measurements.carrySideYd,
    );
    return carryYd === null || carrySideYd === null
      ? []
      : [
          {
            shotId: shot.shotId,
            rowIndex: shot.rowIndex,
            summaryId: shot.summaryId,
            carryYd,
            carrySideYd,
          },
        ];
  });
  return { points, includedShotCount: includedShots.length };
}

export function buildClubDispersionAverages(
  points: readonly DispersionPoint[],
): ClubDispersionAverage[] {
  const totals = new Map<
    number,
    { carry: number; side: number; count: number }
  >();
  for (const point of points) {
    const total = totals.get(point.summaryId) ?? { carry: 0, side: 0, count: 0 };
    total.carry += point.carryYd;
    total.side += point.carrySideYd;
    total.count += 1;
    totals.set(point.summaryId, total);
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left - right)
    .map(([summaryId, total]) => ({
      summaryId,
      carryYd: total.carry / total.count,
      carrySideYd: total.side / total.count,
      shotCount: total.count,
    }));
}

function niceStep(span: number, targetTickCount: number): number {
  const rough = span / targetTickCount;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

function ticksBetween(min: number, max: number, step: number): number[] {
  const ticks: number[] = [];
  for (
    let tick = Math.ceil(min / step) * step;
    tick <= max + step / 1e6;
    tick += step
  ) {
    ticks.push(Math.round(tick * 1e6) / 1e6);
  }
  return ticks;
}

// Lateral bounds stay symmetric so zero is always the visual target line.
export function computeDispersionBounds(
  points: readonly DispersionPoint[],
): DispersionBounds {
  const maxAbsLateral = points.reduce(
    (max, point) => Math.max(max, Math.abs(point.carrySideYd)),
    0,
  );
  const lateralStep = 5;
  const lateralHalfRange = Math.max(
    MIN_LATERAL_HALF_RANGE_YD,
    Math.ceil((maxAbsLateral * 1.2) / lateralStep) * lateralStep,
  );

  const carries = points.map((point) => point.carryYd);
  const rawMin = carries.length > 0 ? Math.min(...carries) : 0;
  const rawMax = carries.length > 0 ? Math.max(...carries) : MIN_CARRY_SPAN_YD;
  const padding = Math.max((rawMax - rawMin) * 0.15, 10);
  const carryStep = niceStep(
    Math.max(rawMax - rawMin + padding * 2, MIN_CARRY_SPAN_YD),
    5,
  );
  let minCarryYd = Math.max(0, Math.floor((rawMin - padding) / carryStep) * carryStep);
  let maxCarryYd = Math.ceil((rawMax + padding) / carryStep) * carryStep;
  if (maxCarryYd - minCarryYd < MIN_CARRY_SPAN_YD) {
    maxCarryYd = minCarryYd + MIN_CARRY_SPAN_YD;
  }
  minCarryYd = Math.max(0, minCarryYd);

  return {
    minLateralYd: -lateralHalfRange,
    maxLateralYd: lateralHalfRange,
    minCarryYd,
    maxCarryYd,
    lateralTicks: ticksBetween(-lateralHalfRange, lateralHalfRange, niceStep(lateralHalfRange * 2, 4)),
    carryTicks: ticksBetween(minCarryYd, maxCarryYd, carryStep),
  };
}
