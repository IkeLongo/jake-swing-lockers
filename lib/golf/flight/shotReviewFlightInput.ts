import type { ShotReviewMeasurements } from "@/lib/imports/golfShotMeasurements";
import type { ModeledShotInput } from "./types";

export interface ShotReviewFlightSource {
  id: number;
  rowIndex: number;
  included: boolean;
  measurementData: ShotReviewMeasurements;
}

export function toModeledShotInput(
  shot: ShotReviewFlightSource,
): ModeledShotInput {
  return {
    shotId: String(shot.id),
    rowIndex: shot.rowIndex,
    included: shot.included,
    measurements: shot.measurementData.measurements,
  };
}
