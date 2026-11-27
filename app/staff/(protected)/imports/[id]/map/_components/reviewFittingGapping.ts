import type { FittingVisualizationShot } from "@/lib/imports/fittingVisualizationData";
import { buildGappingRows as buildCarryGappingRows } from "@/lib/golf/gapping";
import {
  filterIncludedVisualizationShots,
  type ClubFilterSelection,
} from "./reviewFittingDashboardState";

export { computeGappingBounds, MIN_GAPPING_SPAN_YD } from "@/lib/golf/gapping";

export function buildGappingRows(
  shots: readonly FittingVisualizationShot[],
  selection: ClubFilterSelection,
) {
  return buildCarryGappingRows(
    filterIncludedVisualizationShots(shots, selection).map((shot) => ({
      shotId: shot.shotId,
      rowIndex: shot.rowIndex,
      summaryId: shot.summaryId,
      carryYd: shot.measurementData.measurements.carryYd,
    })),
  );
}
