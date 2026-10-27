import test from "node:test";
import assert from "node:assert/strict";
import {
  getShotReviewShotData,
  readGolfShotMeasurements,
} from "@/lib/imports/golfShotMeasurements";
import type { NormalizedGolfShotMeasurements } from "@/lib/imports/golfShotMeasurements";
import { aggregateTrackManClubGroups } from "@/lib/imports/trackmanAggregation";
import { calculateIncludedTrackManSummaryMetrics } from "@/lib/imports/trackmanClubSummaryPersistence";

const EMPTY_MEASUREMENTS = {
  clubSpeedMph: null,
  ballSpeedMph: null,
  launchAngleDeg: null,
  launchDirectionDeg: null,
  spinRateRpm: null,
  spinAxisDeg: null,
  apexDistanceYd: null,
  apexHeightYd: null,
  apexSideYd: null,
  carryYd: null,
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
};

function measuredShot(
  measurements: Partial<NormalizedGolfShotMeasurements> = {},
  club: { type: string | null; tags: string[] } = {
    type: "Driver",
    tags: ["new"],
  },
) {
  return {
    contractVersion: 1,
    source: {
      provider: "trackman",
      exportFormat: "xlsx",
      sheetName: "Result",
      selectedUnitSystem: "US",
      mappingVersion: 1,
      sourceUnits: {},
      lateralSignConvention: "unknown",
      normalizationIssues: [],
    },
    club,
    measurements: { ...EMPTY_MEASUREMENTS, ...measurements },
  };
}

function legacyRow() {
  return {
    "Club.Type": "Driver",
    "Measurement.ClubSpeed": "80",
    "Measurement.BallSpeed": "110",
    "Measurement.SpinRate": "2500",
    "MaxHeight.Height": "25",
    "Measurement.Carry": "150",
    "Measurement.Total": "160",
    tags: ["legacy"],
  };
}

test("reader prefers supported measuredShot values over conflicting flat values", () => {
  const result = readGolfShotMeasurements({
    ...legacyRow(),
    measuredShot: measuredShot(
      {
        clubSpeedMph: 91,
        ballSpeedMph: 130,
        launchAngleDeg: 14,
        launchDirectionDeg: -3,
      },
      { type: "Normalized Driver", tags: ["normalized"] },
    ),
  });

  assert.equal(result.contractVersion, 1);
  assert.equal(result.sourceProvider, "trackman");
  assert.equal(result.hasNormalizedMeasurements, true);
  assert.equal(result.clubType, "Normalized Driver");
  assert.deepEqual(result.tags, ["normalized"]);
  assert.equal(result.measurements.clubSpeedMph, 91);
  assert.equal(result.measurements.launchAngleDeg, 14);
  assert.equal(result.measurements.launchDirectionDeg, -3);
  assert.equal(result.lateralSignConvention, "unknown");
});

test("legacy fallback preserves old numeric behavior without claiming canonical units", () => {
  const result = readGolfShotMeasurements(legacyRow());

  assert.equal(result.contractVersion, null);
  assert.equal(result.sourceProvider, "trackman");
  assert.equal(result.hasNormalizedMeasurements, false);
  assert.equal(result.clubType, "Driver");
  assert.deepEqual(result.tags, ["legacy"]);
  assert.deepEqual(result.measurements, EMPTY_MEASUREMENTS);
  assert.equal(result.lateralSignConvention, null);
  assert.deepEqual(result.summaryMetrics, {
    clubSpeed: 80,
    ballSpeed: 110,
    spinRate: 2500,
    maxHeight: 25,
    carry: 150,
    total: 160,
  });
});

test("missing measuredShot is a valid legacy input", () => {
  const result = readGolfShotMeasurements({ "Club.Type": "5 Wood", tags: [] });
  assert.equal(result.hasNormalizedMeasurements, false);
  assert.deepEqual(result.measurements, EMPTY_MEASUREMENTS);
  assert.equal(result.summaryMetrics.carry, null);
});

test("unsupported contract versions safely fall back to flat keys", () => {
  const result = readGolfShotMeasurements({
    ...legacyRow(),
    measuredShot: { ...measuredShot({ carryYd: 250 }), contractVersion: 2 },
  });

  assert.equal(result.hasNormalizedMeasurements, false);
  assert.equal(result.measurements.carryYd, null);
  assert.equal(result.summaryMetrics.carry, 150);
});

test("malformed measuredShot does not crash and falls back to flat keys", () => {
  const result = readGolfShotMeasurements({
    ...legacyRow(),
    measuredShot: {
      contractVersion: 1,
      source: { provider: "trackman" },
      club: [],
      measurements: { carryYd: "250" },
    },
  });

  assert.equal(result.hasNormalizedMeasurements, false);
  assert.equal(result.measurements.carryYd, null);
  assert.equal(result.summaryMetrics.carry, 150);
});

test("valid contract null values stay null and preserve signed lateral values", () => {
  const result = readGolfShotMeasurements({
    measuredShot: measuredShot({
      launchDirectionDeg: -2.5,
      spinAxisDeg: -12,
      apexSideYd: 3,
      carrySideYd: -4,
      totalSideYd: 5,
    }),
  });

  assert.equal(result.measurements.launchDirectionDeg, -2.5);
  assert.equal(result.measurements.spinAxisDeg, -12);
  assert.equal(result.measurements.apexSideYd, 3);
  assert.equal(result.measurements.carrySideYd, -4);
  assert.equal(result.measurements.totalSideYd, 5);
  assert.equal(result.measurements.launchAngleDeg, null);
  assert.equal(result.measurements.apexDistanceYd, null);
});

test("shot-review serializer preserves legacy fields and exposes normalized payload", () => {
  const response = getShotReviewShotData({
    ...legacyRow(),
    measuredShot: measuredShot({
      clubSpeedMph: 90,
      ballSpeedMph: 125,
      apexHeightYd: 10,
      launchAngleDeg: 13,
    }),
  });

  assert.equal(response.clubType, "Driver");
  assert.deepEqual(response.tags, ["new"]);
  assert.equal(response.clubSpeed, "80");
  assert.equal(response.ballSpeed, "110");
  assert.equal(response.spinRate, "2500");
  assert.equal(response.maxHeight, "25");
  assert.equal(response.carry, "150");
  assert.equal(response.total, "160");
  assert.deepEqual(response.measurementData, {
    contractVersion: 1,
    sourceProvider: "trackman",
    hasNormalizedMeasurements: true,
    lateralSignConvention: "unknown",
    measurements: {
      ...EMPTY_MEASUREMENTS,
      clubSpeedMph: 90,
      ballSpeedMph: 125,
      apexHeightYd: 10,
      launchAngleDeg: 13,
    },
  });
});

test("legacy shot-review payload leaves richer fields unavailable", () => {
  const response = getShotReviewShotData(legacyRow());

  assert.equal(response.clubSpeed, "80");
  assert.equal(response.maxHeight, "25");
  assert.equal(response.measurementData.hasNormalizedMeasurements, false);
  assert.equal(response.measurementData.measurements.launchAngleDeg, null);
  assert.equal(response.measurementData.measurements.carrySideYd, null);
  assert.equal(response.measurementData.measurements.totalSideYd, null);
});

test("aggregation keeps legacy summary values and groups using stable reader fields", () => {
  const groups = aggregateTrackManClubGroups([
    legacyRow(),
    {
      ...legacyRow(),
      "Measurement.Carry": "200",
      "Measurement.Total": "220",
      measuredShot: measuredShot(
        { carryYd: 200, totalYd: 220 },
        { type: "Driver", tags: ["legacy"] },
      ),
    },
  ]);
  const summary = groups[0]?.summary;

  assert.ok(summary);
  assert.equal(summary.clubName, "Driver");
  assert.deepEqual(summary.tags, ["legacy"]);
  assert.equal(summary.shotCount, 2);
  assert.equal(summary.avgClubSpeed, 80);
  assert.equal(summary.avgBallSpeed, 110);
  assert.equal(summary.avgSpinRate, 2500);
  assert.equal(summary.avgMaxHeight, 25);
  assert.equal(summary.avgCarry, 175);
  assert.equal(summary.avgTotal, 190);
});

test("inclusion recalculation supports new measuredShot and legacy rows", () => {
  const metrics = calculateIncludedTrackManSummaryMetrics([
    { rawData: legacyRow(), includedInSummary: true },
    {
      rawData: {
        ...legacyRow(),
        "Measurement.Carry": "200",
        measuredShot: measuredShot({ carryYd: 200 }),
      },
      includedInSummary: false,
    },
    {
      rawData: {
        "Club.Type": "Driver",
        measuredShot: measuredShot({ carryYd: 180 }),
      },
      includedInSummary: true,
    },
  ]);

  assert.equal(metrics.shotCount, 2);
  assert.equal(metrics.avgCarry, 165);
  assert.equal(metrics.validCarryCount, 2);
});
