import type { ShotReviewMeasurements } from "@/lib/imports/golfShotMeasurements";
import type { ModeledShotInput } from "./types";

export interface ShotReviewFlightSource {
  id: number | string;
  rowIndex: number;
  included: boolean;
  clubSummaryId?: number;
  measurementData: ShotReviewMeasurements;
}

export function toModeledShotInput(
  shot: ShotReviewFlightSource,
): ModeledShotInput {
  return {
    shotId: String(shot.id),
    rowIndex: shot.rowIndex,
    included: shot.included,
    ...(shot.clubSummaryId === undefined
      ? {}
      : { clubSummaryId: shot.clubSummaryId }),
    measurements: shot.measurementData.measurements,
  };
}
