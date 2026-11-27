import type { FittingVisualizationShot } from "@/lib/imports/fittingVisualizationData";
import type { DispersionPoint } from "@/lib/golf/dispersion";
import {
  filterIncludedVisualizationShots,
  type ClubFilterSelection,
} from "./reviewFittingDashboardState";

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
