import test from "node:test";
import assert from "node:assert/strict";
import {
  buildModeledShotFlight,
} from "@/lib/golf/flight/modeledFlight";
import {
  getVisibleSelectedFlightId,
  toGolfShotVizFlights,
} from "@/lib/golf/flight/golfShotVizAdapter";
import { yardsToFeet } from "@/lib/golf/flight/units";
import type { FlightMeasurementInput } from "@/lib/golf/flight/types";

const MEASUREMENTS: FlightMeasurementInput = {
  launchAngleDeg: 14,
  launchDirectionDeg: -2,
  apexDistanceYd: 10,
  apexHeightYd: 3,
  apexSideYd: -1,
  carryYd: 20,
  carrySideYd: -2,
  landingAngleDeg: 40,
  totalYd: 22,
  totalSideYd: -2.5,
};

function modeled(
  shotId: string,
  measurements: FlightMeasurementInput = MEASUREMENTS,
  included = true,
) {
  return buildModeledShotFlight({
    shotId,
    rowIndex: Number(shotId.replace(/\D/g, "")) || 0,
    included,
    measurements,
  });
}

test("renderer adapter maps CP3 coordinates to downrange-height-side meters", () => {
  const [flight] = toGolfShotVizFlights([modeled("shot-2")]);
  assert.ok(flight);
  assert.deepEqual(flight.points[0], [0, 0, 0]);
  assert.deepEqual(flight.points[32], [
    10 * 0.9144,
    3 * 0.9144,
    -1 * 0.9144,
  ]);
  assert.deepEqual(flight.points.at(-1), [
    20 * 0.9144,
    0,
    -2 * 0.9144,
  ]);
});

test("renderer mapping preserves identity and converts measured apex height to feet", () => {
  const [flight] = toGolfShotVizFlights([modeled("shot-42")]);
  assert.ok(flight);
  assert.equal(flight.id, "shot-42");
  assert.equal(flight.rowIndex, 42);
  assert.equal(flight.apexHeightFt, 9);
  assert.equal(flight.meta?.club, "Shot 43");
});

test("apex height presentation converts yards to feet without changing nulls", () => {
  assert.equal(yardsToFeet(12.5), 37.5);
  assert.equal(yardsToFeet(null), null);
});

test("only included modeled flights are passed to the renderer", () => {
  const included = modeled("included", MEASUREMENTS, true);
  const excluded = modeled("excluded", MEASUREMENTS, false);
  const insufficient = modeled("insufficient", {
    ...MEASUREMENTS,
    carryYd: null,
  });
  assert.deepEqual(
    toGolfShotVizFlights([included, excluded, insufficient]).map(
      (flight) => flight.id,
    ),
    ["included"],
  );
});

test("missing lateral data is marked and centered only for renderer compatibility", () => {
  const flight = modeled("no-side", {
    ...MEASUREMENTS,
    launchDirectionDeg: null,
    apexSideYd: null,
    carrySideYd: null,
  });
  const [rendererFlight] = toGolfShotVizFlights([flight]);
  assert.ok(rendererFlight);
  assert.equal(rendererFlight.lateralDataAvailable, false);
  assert.ok(rendererFlight.points.every((point) => point[2] === 0));
});

test("empty or entirely insufficient input produces no renderer flights", () => {
  assert.deepEqual(toGolfShotVizFlights([]), []);
  assert.deepEqual(
    toGolfShotVizFlights([
      modeled("legacy", {
        ...MEASUREMENTS,
        launchAngleDeg: null,
        apexDistanceYd: null,
        apexHeightYd: null,
        carryYd: null,
        landingAngleDeg: null,
      }),
    ]),
    [],
  );
});

test("selection resolves only to the matching rendered shot", () => {
  const flights = toGolfShotVizFlights([
    modeled("shot-1"),
    modeled("shot-2"),
  ]);
  assert.equal(getVisibleSelectedFlightId(flights, "shot-2"), "shot-2");
  assert.equal(getVisibleSelectedFlightId(flights, "missing"), null);
  assert.equal(getVisibleSelectedFlightId(flights, null), null);
});
