import test from "node:test";
import assert from "node:assert/strict";
import {
  buildClubFlightModel,
  buildModeledShotFlight,
} from "@/lib/golf/flight/modeledFlight";
import type {
  FlightMeasurementInput,
  ModeledShotInput,
} from "@/lib/golf/flight/types";

const COMPLETE_MEASUREMENTS: FlightMeasurementInput = {
  launchAngleDeg: 14,
  launchDirectionDeg: -2,
  apexDistanceYd: 100,
  apexHeightYd: 30,
  apexSideYd: -4,
  carryYd: 200,
  carrySideYd: -7,
  landingAngleDeg: 40,
  totalYd: 220,
  totalSideYd: -9,
};

function shot(
  measurements: Partial<FlightMeasurementInput> = {},
  identity: Partial<Pick<ModeledShotInput, "shotId" | "rowIndex" | "included">> = {},
): ModeledShotInput {
  return {
    shotId: identity.shotId ?? "shot-1",
    rowIndex: identity.rowIndex ?? 8,
    included: identity.included ?? true,
    measurements: { ...COMPLETE_MEASUREMENTS, ...measurements },
  };
}

function expectModeled(result: ReturnType<typeof buildModeledShotFlight>) {
  assert.equal(result.status, "modeled");
  assert.ok(result.modeledPoints.length > 0);
  return result.modeledPoints;
}

test("modeled flight starts at the exact coordinate origin", () => {
  const result = buildModeledShotFlight(shot());
  const points = expectModeled(result);
  assert.deepEqual(points[0], {
    downrangeYd: 0,
    heightYd: 0,
    lateralYd: 0,
  });
  assert.deepEqual(result.measuredLandmarks.origin, {
    downrangeYd: 0,
    heightYd: 0,
    lateralYd: 0,
    provenance: "coordinate-origin",
  });
});

test("modeled flight passes through measured apex and carry landmarks", () => {
  const result = buildModeledShotFlight(shot());
  const points = expectModeled(result);
  assert.ok(points.some((point) => point.downrangeYd === 100 && point.heightYd === 30));
  assert.ok(points.some((point) => point.downrangeYd === 200 && point.heightYd === 0));
});

test("apex height matches the measured apex height", () => {
  const points = expectModeled(buildModeledShotFlight(shot()));
  const maximumHeight = Math.max(...points.map((point) => point.heightYd));
  assert.equal(maximumHeight, 30);
});

test("vertical slope is approximately zero at the apex", () => {
  const points = expectModeled(
    buildModeledShotFlight(shot(), { samplesPerSegment: 10_000 }),
  );
  const apexIndex = 10_000;
  const leftSlope =
    (points[apexIndex].heightYd - points[apexIndex - 1].heightYd) /
    (points[apexIndex].downrangeYd - points[apexIndex - 1].downrangeYd);
  const rightSlope =
    (points[apexIndex + 1].heightYd - points[apexIndex].heightYd) /
    (points[apexIndex + 1].downrangeYd - points[apexIndex].downrangeYd);
  assert.ok(Math.abs(leftSlope) < 0.001);
  assert.ok(Math.abs(rightSlope) < 0.001);
});

test("initial vertical tangent matches launch angle", () => {
  const points = expectModeled(
    buildModeledShotFlight(shot(), { samplesPerSegment: 10_000 }),
  );
  const initialSlope =
    (points[1].heightYd - points[0].heightYd) /
    (points[1].downrangeYd - points[0].downrangeYd);
  assert.ok(Math.abs(initialSlope - Math.tan((14 * Math.PI) / 180)) < 0.001);
});

test("initial lateral tangent matches signed launch direction", () => {
  const points = expectModeled(
    buildModeledShotFlight(shot(), { samplesPerSegment: 10_000 }),
  );
  const initialSlope =
    ((points[1].lateralYd ?? 0) - (points[0].lateralYd ?? 0)) /
    (points[1].downrangeYd - points[0].downrangeYd);
  assert.ok(Math.abs(initialSlope - Math.tan((-2 * Math.PI) / 180)) < 0.001);
});

test("terminal vertical tangent descends at the measured landing angle", () => {
  const points = expectModeled(
    buildModeledShotFlight(shot(), { samplesPerSegment: 10_000 }),
  );
  const last = points.length - 1;
  const terminalSlope =
    (points[last].heightYd - points[last - 1].heightYd) /
    (points[last].downrangeYd - points[last - 1].downrangeYd);
  assert.ok(Math.abs(terminalSlope + Math.tan((40 * Math.PI) / 180)) < 0.001);
});

test("vertical height stays nonnegative and has no second apex", () => {
  const points = expectModeled(buildModeledShotFlight(shot()));
  const apexIndex = points.findIndex(
    (point) => point.downrangeYd === COMPLETE_MEASUREMENTS.apexDistanceYd,
  );
  assert.ok(apexIndex > 0);
  assert.ok(points.every((point) => point.heightYd >= 0));
  assert.ok(
    points.slice(1, apexIndex + 1).every((point, index) =>
      point.heightYd >= points[index].heightYd,
    ),
  );
  assert.ok(
    points.slice(apexIndex + 1).every((point, index) =>
      point.heightYd <= points[apexIndex + index].heightYd,
    ),
  );
});

test("lateral model starts at zero and passes through apex and carry sides", () => {
  const points = expectModeled(buildModeledShotFlight(shot()));
  assert.equal(points[0].lateralYd, 0);
  assert.equal(points[32].lateralYd, -4);
  assert.equal(points.at(-1)?.lateralYd, -7);
});

test("signed lateral values are preserved without left/right semantics", () => {
  const result = buildModeledShotFlight(
    shot({ apexSideYd: 5, carrySideYd: -3, launchDirectionDeg: 2 }),
  );
  const points = expectModeled(result);
  assert.equal(points[32].lateralYd, 5);
  assert.equal(points.at(-1)?.lateralYd, -3);
  assert.equal("left" in points[32], false);
  assert.equal("right" in points[32], false);
});

test("modeled flight output is deterministic", () => {
  const input = shot();
  assert.deepEqual(
    buildModeledShotFlight(input),
    buildModeledShotFlight(input),
  );
});

test("default and configurable point sampling include both landmarks", () => {
  const defaultResult = buildModeledShotFlight(shot());
  const sparseResult = buildModeledShotFlight(shot(), { samplesPerSegment: 4 });
  const defaultPoints = expectModeled(defaultResult);
  const sparsePoints = expectModeled(sparseResult);
  assert.equal(defaultPoints.length, 65);
  assert.equal(sparsePoints.length, 9);
  assert.ok(sparsePoints.some((point) => point.downrangeYd === 100));
  assert.ok(sparsePoints.some((point) => point.downrangeYd === 200));
});

test("invalid sample density is rejected", () => {
  assert.throws(
    () => buildModeledShotFlight(shot(), { samplesPerSegment: 1 }),
    RangeError,
  );
});

test("missing carry returns insufficient-data without geometry", () => {
  const result = buildModeledShotFlight(shot({ carryYd: null }));
  assert.equal(result.status, "insufficient-data");
  assert.deepEqual(result.insufficientReasons, ["missing-carry"]);
  assert.deepEqual(result.modeledPoints, []);
});

test("missing apex returns insufficient-data without fabricated landmarks", () => {
  const result = buildModeledShotFlight(
    shot({
      apexDistanceYd: null,
      apexHeightYd: null,
      apexSideYd: null,
    }),
  );
  assert.equal(result.status, "insufficient-data");
  assert.deepEqual(result.insufficientReasons, ["missing-apex"]);
  assert.equal(result.measuredLandmarks.apex, null);
});

test("partial measured landmarks are retained without invented coordinates", () => {
  const result = buildModeledShotFlight(
    shot({ apexDistanceYd: 92, apexHeightYd: null, apexSideYd: -1.5 }),
  );
  assert.equal(result.status, "insufficient-data");
  assert.deepEqual(result.measuredLandmarks.apex, {
    downrangeYd: 92,
    heightYd: null,
    lateralYd: -1.5,
    provenance: "trackman-measured",
  });
  assert.deepEqual(result.modeledPoints, []);
});

test("missing launch and landing constraints are explicitly reported", () => {
  const result = buildModeledShotFlight(
    shot({ launchAngleDeg: null, landingAngleDeg: null }),
  );
  assert.equal(result.status, "insufficient-data");
  assert.deepEqual(result.insufficientReasons, [
    "missing-launch-angle",
    "missing-landing-angle",
  ]);
});

test("inconsistent launch constraints are rejected rather than reshaped", () => {
  const result = buildModeledShotFlight(
    shot({ launchAngleDeg: 70, landingAngleDeg: 5 }),
  );
  assert.equal(result.status, "insufficient-data");
  assert.deepEqual(result.insufficientReasons, ["invalid-vertical-constraints"]);
});

test("missing lateral measurements leave lateral positions null", () => {
  const result = buildModeledShotFlight(
    shot({ launchDirectionDeg: null, apexSideYd: null, carrySideYd: null }),
  );
  const points = expectModeled(result);
  assert.equal(result.lateralStatus, "insufficient-data");
  assert.equal(result.lateralReason, "missing-launch-direction");
  assert.ok(points.every((point) => point.lateralYd === null));
});

test("missing lateral landmarks are not replaced with centerline values", () => {
  const result = buildModeledShotFlight(shot({ apexSideYd: null }));
  const points = expectModeled(result);
  assert.equal(result.lateralStatus, "insufficient-data");
  assert.equal(result.lateralReason, "missing-apex-side");
  assert.ok(points.every((point) => point.lateralYd === null));
  assert.equal(result.measuredLandmarks.apex?.lateralYd, null);
});

test("lateral direction singularities are rejected without non-finite points", () => {
  const result = buildModeledShotFlight(shot({ launchDirectionDeg: 90 }));
  const points = expectModeled(result);
  assert.equal(result.lateralStatus, "insufficient-data");
  assert.equal(result.lateralReason, "invalid-launch-direction");
  assert.ok(points.every((point) => point.lateralYd === null));
});

test("total is retained as a measured landmark and not airborne geometry", () => {
  const result = buildModeledShotFlight(shot());
  const points = expectModeled(result);
  assert.deepEqual(result.measuredLandmarks.total, {
    downrangeYd: 220,
    lateralYd: -9,
    provenance: "trackman-measured",
  });
  assert.equal(Math.max(...points.map((point) => point.downrangeYd)), 200);
});

test("club model preserves shot identity and inclusion state", () => {
  const result = buildClubFlightModel([
    shot({}, { shotId: "a", rowIndex: 4, included: true }),
    shot({}, { shotId: "b", rowIndex: 9, included: false }),
  ]);
  assert.deepEqual(
    result.flights.map(({ shotId, rowIndex, included }) => ({
      shotId,
      rowIndex,
      included,
    })),
    [
      { shotId: "a", rowIndex: 4, included: true },
      { shotId: "b", rowIndex: 9, included: false },
    ],
  );
});

test("included-only mode filters excluded shots", () => {
  const result = buildClubFlightModel(
    [
      shot({}, { shotId: "included", included: true }),
      shot({}, { shotId: "excluded", included: false }),
    ],
    { includedOnly: true },
  );
  assert.deepEqual(
    result.flights.map((flight) => flight.shotId),
    ["included"],
  );
});

test("club bounds encompass all modeled returned flight points", () => {
  const result = buildClubFlightModel([
    shot(),
    shot({ carryYd: 180, apexDistanceYd: 80, apexHeightYd: 25 }),
  ]);
  const points = result.flights.flatMap((flight) => flight.modeledPoints);
  assert.equal(result.bounds.minDownrangeYd, Math.min(...points.map((p) => p.downrangeYd)));
  assert.equal(result.bounds.maxDownrangeYd, Math.max(...points.map((p) => p.downrangeYd)));
  assert.equal(result.bounds.minHeightYd, Math.min(...points.map((p) => p.heightYd)));
  assert.equal(result.bounds.maxHeightYd, Math.max(...points.map((p) => p.heightYd)));
  assert.equal(
    result.bounds.minLateralYd,
    Math.min(...points.map((p) => p.lateralYd ?? Infinity)),
  );
  assert.equal(
    result.bounds.maxLateralYd,
    Math.max(...points.map((p) => p.lateralYd ?? -Infinity)),
  );
});

test("empty club input returns empty flights and null bounds", () => {
  assert.deepEqual(buildClubFlightModel([]), {
    flights: [],
    bounds: {
      minDownrangeYd: null,
      maxDownrangeYd: null,
      minHeightYd: null,
      maxHeightYd: null,
      minLateralYd: null,
      maxLateralYd: null,
    },
  });
});

test("legacy measurements without normalized constraints fail safely", () => {
  const legacyMeasurements: FlightMeasurementInput = {
    launchAngleDeg: null,
    launchDirectionDeg: null,
    apexDistanceYd: null,
    apexHeightYd: null,
    apexSideYd: null,
    carryYd: null,
    carrySideYd: null,
    landingAngleDeg: null,
    totalYd: null,
    totalSideYd: null,
  };
  const result = buildModeledShotFlight(shot(legacyMeasurements));
  assert.equal(result.status, "insufficient-data");
  assert.deepEqual(result.insufficientReasons, [
    "missing-carry",
    "missing-apex",
    "missing-launch-angle",
    "missing-landing-angle",
  ]);
  assert.deepEqual(result.modeledPoints, []);
});

test("club bounds are empty when every shot lacks required model data", () => {
  const result = buildClubFlightModel([shot({ carryYd: null })]);
  assert.equal(result.flights[0]?.status, "insufficient-data");
  assert.equal(result.bounds.minDownrangeYd, null);
  assert.equal(result.bounds.maxLateralYd, null);
});
