import assert from "node:assert/strict";
import test from "node:test";
import type { FittingVisualizationShot } from "@/lib/imports/fittingVisualizationData";
import type { ShotReviewMeasurements } from "@/lib/imports/golfShotMeasurements";
import {
  buildClubDispersionAverages,
  buildDispersionPoints,
  computeDispersionBounds,
  MIN_CARRY_SPAN_YD,
  MIN_LATERAL_HALF_RANGE_YD,
} from "../app/staff/(protected)/imports/[id]/map/_components/reviewFittingDispersion";
import { createClubColorMap } from "../app/staff/(protected)/imports/[id]/map/_components/reviewFittingDashboardState";

function shot(
  shotId: string,
  summaryId: number,
  carryYd: number | null,
  carrySideYd: number | null,
  included = true,
): FittingVisualizationShot {
  const measurementData: ShotReviewMeasurements = {
    contractVersion: 1,
    sourceProvider: "trackman",
    hasNormalizedMeasurements: true,
    lateralSignConvention: "unknown",
    measurements: {
      clubSpeedMph: null,
      ballSpeedMph: null,
      launchAngleDeg: null,
      launchDirectionDeg: null,
      spinRateRpm: null,
      spinAxisDeg: null,
      apexDistanceYd: null,
      apexHeightYd: null,
      apexSideYd: null,
      carryYd,
      carrySideYd,
      landingAngleDeg: null,
      carryBallSpeedMph: null,
      hangTimeS: null,
      totalYd: null,
      totalSideYd: null,
      attackAngleDeg: null,
      clubPathDeg: null,
      faceAngleDeg: null,
      dynamicLoftDeg: null,
      smashFactor: null,
    },
  };
  return {
    shotId,
    rowIndex: Number(shotId),
    summaryId,
    clubName: `Club ${summaryId}`,
    tags: [],
    included,
    measurementData,
  };
}

const SHOTS = [
  shot("1", 21, 180, -6.2),
  shot("2", 21, 184, 0),
  shot("3", 22, 150, 4.5),
  shot("4", 22, 152, 5.5, false),
  shot("5", 22, null, 3),
  shot("6", 23, 120, null),
];

test("included valid shots become dispersion points and excluded shots are omitted", () => {
  const { points, includedShotCount } = buildDispersionPoints(SHOTS, null);
  assert.deepEqual(points.map((point) => point.shotId), ["1", "2", "3"]);
  assert.equal(includedShotCount, 5);
});

test("missing carry or lateral never creates a point or fabricated zero", () => {
  const { points } = buildDispersionPoints(SHOTS, null);
  assert.equal(points.some((point) => point.shotId === "5"), false);
  assert.equal(points.some((point) => point.shotId === "6"), false);
});

test("zero lateral is valid and measured values are preserved exactly", () => {
  const { points } = buildDispersionPoints(SHOTS, null);
  assert.equal(points.find((point) => point.shotId === "2")?.carrySideYd, 0);
  assert.equal(points.find((point) => point.shotId === "1")?.carrySideYd, -6.2);
  assert.equal(points.find((point) => point.shotId === "1")?.carryYd, 180);
});

test("dispersion follows the shared single and multi-club selection", () => {
  assert.deepEqual(
    buildDispersionPoints(SHOTS, new Set([22])).points.map((point) => point.shotId),
    ["3"],
  );
  assert.deepEqual(
    buildDispersionPoints(SHOTS, new Set([21, 22])).points.map((point) => point.shotId),
    ["1", "2", "3"],
  );
  assert.equal(buildDispersionPoints(SHOTS, null).points.length, 3);
});

test("dispersion points retain summary IDs that map to the shared club colors", () => {
  const colors = createClubColorMap([22, 21, 23], ["green", "gold", "blue"]);
  const points = buildDispersionPoints(SHOTS, null).points;
  assert.deepEqual(
    points.map((point) => colors.get(point.summaryId)),
    ["green", "green", "gold"],
  );
  assert.equal(
    colors.get(buildDispersionPoints(SHOTS, new Set([22])).points[0]!.summaryId),
    colors.get(22),
  );
});

test("club averages use only visible valid included shots", () => {
  const averages = buildClubDispersionAverages(
    buildDispersionPoints(SHOTS, new Set([21, 22])).points,
  );
  assert.deepEqual(averages, [
    { summaryId: 21, carryYd: 182, carrySideYd: -3.1, shotCount: 2 },
    { summaryId: 22, carryYd: 150, carrySideYd: 4.5, shotCount: 1 },
  ]);
});

test("bounds apply minimum symmetric lateral range and carry padding", () => {
  const tight = computeDispersionBounds(
    buildDispersionPoints([shot("1", 21, 180, 0.5)], null).points,
  );
  assert.equal(tight.minLateralYd, -MIN_LATERAL_HALF_RANGE_YD);
  assert.equal(tight.maxLateralYd, MIN_LATERAL_HALF_RANGE_YD);
  assert.ok(tight.lateralTicks.includes(0));
  assert.ok(tight.minCarryYd < 180 && tight.maxCarryYd > 180);
  assert.ok(tight.maxCarryYd - tight.minCarryYd >= MIN_CARRY_SPAN_YD);

  const wide = computeDispersionBounds(
    buildDispersionPoints([shot("1", 21, 100, -40), shot("2", 21, 200, 12)], null).points,
  );
  assert.equal(wide.minLateralYd, -wide.maxLateralYd);
  assert.ok(wide.maxLateralYd >= 40);
  assert.ok(wide.minCarryYd <= 100 && wide.maxCarryYd >= 200);
  assert.ok(wide.minCarryYd >= 0);
});
