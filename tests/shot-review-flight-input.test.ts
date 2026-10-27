import test from "node:test";
import assert from "node:assert/strict";
import { toModeledShotInput } from "@/lib/golf/flight/shotReviewFlightInput";
import type { ShotReviewMeasurements } from "@/lib/imports/golfShotMeasurements";

test("shot-review response maps to the CP3 input without source data", () => {
  const measurements: ShotReviewMeasurements = {
    contractVersion: 1,
    sourceProvider: "trackman",
    hasNormalizedMeasurements: true,
    lateralSignConvention: "unknown",
    measurements: {
      clubSpeedMph: null,
      ballSpeedMph: 132,
      launchAngleDeg: 14,
      launchDirectionDeg: -2,
      spinRateRpm: null,
      spinAxisDeg: null,
      apexDistanceYd: 100,
      apexHeightYd: 30,
      apexSideYd: -4,
      carryYd: 200,
      carrySideYd: -7,
      landingAngleDeg: 40,
      carryBallSpeedMph: null,
      hangTimeS: null,
      totalYd: 220,
      totalSideYd: -9,
      attackAngleDeg: null,
      clubPathDeg: null,
      faceAngleDeg: null,
      dynamicLoftDeg: null,
      smashFactor: null,
    },
  };

  assert.deepEqual(
    toModeledShotInput({
      id: 501,
      rowIndex: 12,
      included: true,
      measurementData: measurements,
    }),
    {
      shotId: "501",
      rowIndex: 12,
      included: true,
      measurements: measurements.measurements,
    },
  );
});
