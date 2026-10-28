import assert from "node:assert/strict";
import test from "node:test";
import type { FittingVisualizationShot } from "@/lib/imports/fittingVisualizationData";
import type { ShotReviewMeasurements } from "@/lib/imports/golfShotMeasurements";
import {
  buildGappingRows,
  computeGappingBounds,
  MIN_GAPPING_SPAN_YD,
} from "../app/staff/(protected)/imports/[id]/map/_components/reviewFittingGapping";
import { createClubColorMap } from "../app/staff/(protected)/imports/[id]/map/_components/reviewFittingDashboardState";

function shot(
  shotId: string,
  summaryId: number,
  carryYd: number | null,
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
      carrySideYd: null,
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
  shot("1", 21, 170),
  shot("2", 21, 180),
  shot("3", 21, 400, false),
  shot("4", 21, null),
  shot("5", 22, 190),
  shot("6", 22, 200),
  shot("7", 23, 0),
  shot("8", 23, 150),
];

test("included valid carry shots become points; excluded and missing are omitted", () => {
  const { rows, includedShotCount } = buildGappingRows(SHOTS, null);
  assert.deepEqual(
    rows.find((row) => row.summaryId === 21)!.points.map((point) => point.shotId),
    ["1", "2"],
  );
  assert.equal(includedShotCount, 7);
});

test("zero carry is preserved rather than treated as missing", () => {
  const row = buildGappingRows(SHOTS, new Set([23])).rows[0]!;
  assert.deepEqual(row.points.map((point) => point.carryYd), [0, 150]);
  assert.equal(row.minCarryYd, 0);
  assert.equal(row.averageCarryYd, 75);
});

test("average and range use only included valid shots", () => {
  const row = buildGappingRows(SHOTS, new Set([21])).rows[0]!;
  assert.equal(row.averageCarryYd, 175);
  assert.equal(row.minCarryYd, 170);
  assert.equal(row.maxCarryYd, 180);
});

test("clubs sort by measured average carry descending", () => {
  assert.deepEqual(
    buildGappingRows(SHOTS, null).rows.map((row) => row.summaryId),
    [22, 21, 23],
  );
});

test("gapping follows single, multi-club, and All Clubs selection", () => {
  assert.deepEqual(buildGappingRows(SHOTS, new Set([22])).rows.map((r) => r.summaryId), [22]);
  assert.deepEqual(buildGappingRows(SHOTS, new Set([21, 22])).rows.map((r) => r.summaryId), [22, 21]);
  assert.equal(buildGappingRows(SHOTS, null).rows.length, 3);
});

test("clubs with no valid carry are omitted without failing", () => {
  const { rows } = buildGappingRows([shot("1", 21, null)], null);
  assert.deepEqual(rows, []);
  assert.doesNotThrow(() => computeGappingBounds(rows));
});

test("row summary IDs map to the shared club colors", () => {
  const colors = createClubColorMap([21, 22, 23], ["green", "gold", "blue"]);
  assert.deepEqual(
    buildGappingRows(SHOTS, null).rows.map((row) => colors.get(row.summaryId)),
    ["gold", "green", "blue"],
  );
});

test("bounds pad the visible range and do not force zero", () => {
  const bounds = computeGappingBounds(buildGappingRows(SHOTS, new Set([21, 22])).rows);
  assert.ok(bounds.minYd < 170 && bounds.minYd > 100);
  assert.ok(bounds.maxYd > 200);
  assert.ok(bounds.maxYd - bounds.minYd >= MIN_GAPPING_SPAN_YD);
  assert.ok(bounds.ticks.length >= 3);

  const single = computeGappingBounds(buildGappingRows([shot("1", 21, 180)], null).rows);
  assert.ok(single.minYd < 180 && single.maxYd > 180);
  assert.ok(single.maxYd - single.minYd >= MIN_GAPPING_SPAN_YD);
});
