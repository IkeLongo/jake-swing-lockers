import assert from "node:assert/strict";
import test from "node:test";
import { buildModeledShotFlight } from "@/lib/golf/flight/modeledFlight";
import {
  toGolfShotVizFlights,
} from "@/lib/golf/flight/golfShotVizAdapter";
import type { FlightMeasurementInput } from "@/lib/golf/flight/types";
import {
  getFittingVisualizationAccessError,
  serializeFittingVisualizationShots,
  type FittingVisualizationShot,
} from "@/lib/imports/fittingVisualizationData";
import {
  buildClubComparisonMetricRows,
  buildFittingClubLegend,
  buildFittingFlightModel,
  createClubColorMap,
  filterIncludedVisualizationShots,
  formatClubResultMetric,
  toggleClubFilterSelection,
} from "../app/staff/(protected)/imports/[id]/map/_components/reviewFittingDashboardState";
import type { ShotReviewMeasurements } from "@/lib/imports/golfShotMeasurements";

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

function shotReviewMeasurements(
  measurements: FlightMeasurementInput,
): ShotReviewMeasurements {
  return {
    contractVersion: 1,
    sourceProvider: "trackman",
    hasNormalizedMeasurements: true,
    lateralSignConvention: "unknown",
    measurements: {
      clubSpeedMph: null,
      ballSpeedMph: null,
      launchAngleDeg: measurements.launchAngleDeg,
      launchDirectionDeg: measurements.launchDirectionDeg,
      spinRateRpm: null,
      spinAxisDeg: null,
      apexDistanceYd: measurements.apexDistanceYd,
      apexHeightYd: measurements.apexHeightYd,
      apexSideYd: measurements.apexSideYd,
      carryYd: measurements.carryYd,
      carrySideYd: measurements.carrySideYd,
      landingAngleDeg: measurements.landingAngleDeg,
      carryBallSpeedMph: null,
      hangTimeS: null,
      totalYd: measurements.totalYd,
      totalSideYd: measurements.totalSideYd,
      attackAngleDeg: null,
      clubPathDeg: null,
      faceAngleDeg: null,
      dynamicLoftDeg: null,
      smashFactor: null,
    },
  };
}

function visualizationShot(
  shotId: string,
  summaryId: number,
  included = true,
  measurements: FlightMeasurementInput = MEASUREMENTS,
): FittingVisualizationShot {
  return {
    shotId,
    rowIndex: Number(shotId),
    summaryId,
    clubName: `Club ${summaryId}`,
    tags: [],
    included,
    measurementData: shotReviewMeasurements(measurements),
  };
}

test("visualization endpoint access rejects unauthorized and ineligible requests", () => {
  assert.deepEqual(getFittingVisualizationAccessError(false, undefined), {
    status: 401,
    error: "Unauthorized.",
  });
  assert.deepEqual(getFittingVisualizationAccessError(true, null), {
    status: 404,
    error: "Import batch not found.",
  });
  assert.equal(
    getFittingVisualizationAccessError(true, {
      parserMode: "generic",
      demoSessionId: null,
    })?.status,
    409,
  );
  assert.equal(
    getFittingVisualizationAccessError(true, {
      parserMode: "trackman-result",
      demoSessionId: 7,
    })?.status,
    409,
  );
  assert.equal(
    getFittingVisualizationAccessError(true, {
      parserMode: "trackman-result",
      demoSessionId: null,
    }),
    null,
  );
});

test("visualization response retains shot and club identity without raw rows", () => {
  const measurementData = shotReviewMeasurements(MEASUREMENTS);
  const data = serializeFittingVisualizationShots(
    [
      { id: 21, clubName: "  3 Wood  ", tags: ["Mens"] },
      { id: 22, clubName: " ", tags: [] },
    ],
    [
      {
        id: 501,
        rowIndex: 4,
        clubSummaryId: 21,
        includedInSummary: true,
        measurementData,
      },
      {
        id: 502,
        rowIndex: 5,
        clubSummaryId: 22,
        includedInSummary: false,
        measurementData,
      },
      {
        id: 503,
        rowIndex: 6,
        clubSummaryId: null,
        includedInSummary: true,
        measurementData,
      },
    ],
  );

  assert.deepEqual(data.shots.map(({ shotId, summaryId }) => ({ shotId, summaryId })), [
    { shotId: "501", summaryId: 21 },
    { shotId: "502", summaryId: 22 },
  ]);
  assert.equal(data.shots[0]?.rowIndex, 4);
  assert.equal(data.shots[0]?.clubName, "3 Wood");
  assert.deepEqual(data.shots[0]?.tags, ["Mens"]);
  assert.equal(data.shots[0]?.included, true);
  assert.equal(data.shots[1]?.clubName, "Unknown Club");
  assert.equal(data.shots[1]?.included, false);
  assert.deepEqual(data.shots[0]?.measurementData, measurementData);
  assert.equal(Object.hasOwn(data, "rawData"), false);
  assert.equal(Object.hasOwn(data.shots[0]!, "rawData"), false);
  assert.equal(Object.hasOwn(data.shots[0]!, "avgMaxHeight"), false);
});

test("All Clubs and selected club filters use cached fitting shots and inclusion", () => {
  const shots = [
    visualizationShot("11", 21),
    visualizationShot("12", 21, false),
    visualizationShot("13", 22),
  ];

  assert.deepEqual(
    filterIncludedVisualizationShots(shots, null).map((shot) => shot.shotId),
    ["11", "13"],
  );
  assert.deepEqual(
    filterIncludedVisualizationShots(shots, new Set([21])).map((shot) => shot.shotId),
    ["11"],
  );
  assert.deepEqual(
    filterIncludedVisualizationShots(shots, new Set([22])).map((shot) => shot.shotId),
    ["13"],
  );
  assert.deepEqual(
    filterIncludedVisualizationShots(shots, new Set([21, 22])).map((shot) => shot.shotId),
    ["11", "13"],
  );
  assert.deepEqual(
    filterIncludedVisualizationShots(shots, null).map((shot) => shot.summaryId),
    [21, 22],
  );
});

test("insufficient measurements are omitted while valid flights remain renderable", () => {
  const data = buildFittingFlightModel(
    [
      visualizationShot("31", 21),
      visualizationShot("32", 21, true, {
        ...MEASUREMENTS,
        apexDistanceYd: null,
        apexHeightYd: null,
        carryYd: null,
        launchAngleDeg: null,
        landingAngleDeg: null,
      }),
    ],
    null,
  );

  const rendererFlights = toGolfShotVizFlights(data.flights);
  assert.deepEqual(rendererFlights.map((flight) => flight.id), ["31"]);
  assert.equal(data.shots.length, 2);
});

test("combined comparison flight keeps group shots, inclusion, modelability, and club colors", () => {
  const colors = createClubColorMap([21, 22, 23, 24], [
    "green",
    "blue",
    "gold",
    "red",
  ]);
  const comparison = buildFittingFlightModel(
    [
      visualizationShot("41", 21),
      visualizationShot("42", 22),
      visualizationShot("43", 22, false),
      visualizationShot("44", 23, true, {
        ...MEASUREMENTS,
        apexDistanceYd: null,
        apexHeightYd: null,
        carryYd: null,
        launchAngleDeg: null,
        landingAngleDeg: null,
      }),
      visualizationShot("45", 24),
    ],
    new Set([21, 22, 23]),
  );
  const rendererFlights = toGolfShotVizFlights(comparison.flights, {
    colorsBySummaryId: colors,
  });

  assert.deepEqual(
    comparison.shots.map(({ shotId, summaryId }) => [shotId, summaryId]),
    [
      ["41", 21],
      ["42", 22],
      ["44", 23],
    ],
  );
  assert.deepEqual(
    rendererFlights.map(({ id, clubSummaryId, color }) => [
      id,
      clubSummaryId,
      color,
    ]),
    [
      ["41", 21, "green"],
      ["42", 22, "blue"],
    ],
  );
});

test("club colors are stable by summary ID regardless of order or filtering", () => {
  const palette = ["green", "blue", "gold"];
  const colors = createClubColorMap([9, 3, 5], palette);
  const reordered = createClubColorMap([5, 9, 3], palette);
  const filtered = createClubColorMap([3, 5, 9], palette);

  assert.equal(colors.get(3), "green");
  assert.equal(colors.get(5), "blue");
  assert.equal(colors.get(9), "gold");
  assert.deepEqual([...reordered], [...colors]);
  assert.equal(filtered.get(9), colors.get(9));
  assert.equal(new Set(colors.values()).size, 3);
  assert.equal(createClubColorMap([3, 5, 9, 12], palette).get(12), "green");
});

test("comparison metrics are hidden for one club and use only the selected group", () => {
  const summaries = [
    {
      id: 21,
      clubName: "3 Hybrid",
      avgCarry: 186,
      avgTotal: 198,
      avgBallSpeed: 139,
      avgClubSpeed: 96,
      avgSpinRate: 3850,
    },
    {
      id: 22,
      clubName: "3 Wood",
      avgCarry: 201,
      avgTotal: 215,
      avgBallSpeed: 146,
      avgClubSpeed: 98,
      avgSpinRate: 3300,
    },
    {
      id: 23,
      clubName: "Unrelated",
      avgCarry: 150,
      avgTotal: 170,
      avgBallSpeed: 120,
      avgClubSpeed: 80,
      avgSpinRate: 3000,
    },
  ];
  const colors = createClubColorMap(
    summaries.map(({ id }) => id),
    ["green", "blue", "gold"],
  );

  assert.deepEqual(buildClubComparisonMetricRows(summaries, [21], colors), []);
  assert.deepEqual(
    buildClubComparisonMetricRows(summaries, [21, 22], colors),
    [
      {
        summaryId: 21,
        clubName: "3 Hybrid",
        color: "green",
        avgCarry: 186,
        avgTotal: 198,
        avgBallSpeed: 139,
        avgClubSpeed: 96,
        avgSpinRate: 3850,
      },
      {
        summaryId: 22,
        clubName: "3 Wood",
        color: "blue",
        avgCarry: 201,
        avgTotal: 215,
        avgBallSpeed: 146,
        avgClubSpeed: 98,
        avgSpinRate: 3300,
      },
    ],
  );
});

test("comparison metric rows follow group updates and preserve missing measured values", () => {
  const summaries = [
    {
      id: 21,
      clubName: "3 Hybrid",
      avgCarry: 186,
      avgTotal: null,
      avgBallSpeed: 139,
      avgClubSpeed: null,
      avgSpinRate: 3850,
    },
    {
      id: 22,
      clubName: "3 Wood",
      avgCarry: 201,
      avgTotal: 215,
      avgBallSpeed: 146,
      avgClubSpeed: 98,
      avgSpinRate: 3300,
    },
    {
      id: 23,
      clubName: "4 Hybrid",
      avgCarry: 175,
      avgTotal: 194,
      avgBallSpeed: 132,
      avgClubSpeed: 89,
      avgSpinRate: 3600,
    },
  ];
  const colors = createClubColorMap([21, 22, 23], ["green", "blue", "gold"]);

  const originalGroup = buildClubComparisonMetricRows(
    summaries,
    [21, 22],
    colors,
  );
  const updatedGroup = buildClubComparisonMetricRows(
    summaries,
    [21, 23],
    colors,
  );

  assert.deepEqual(
    originalGroup.map(({ summaryId }) => summaryId),
    [21, 22],
  );
  assert.deepEqual(
    updatedGroup.map(({ summaryId }) => summaryId),
    [21, 23],
  );
  assert.equal(originalGroup[0]?.avgTotal, null);
  assert.equal(
    formatClubResultMetric(originalGroup[0]?.avgTotal ?? null),
    "—",
  );
  assert.equal(
    formatClubResultMetric(originalGroup[0]?.avgSpinRate ?? null, 0),
    "3,850",
  );
  assert.deepEqual(
    updatedGroup.map(({ color }) => color),
    ["green", "gold"],
  );
});

test("detailed club shots use dashboard summary colors independent of shot order", () => {
  const colors = createClubColorMap([21, 22], ["green", "blue"]);
  const flights = [
    buildModeledShotFlight({
      shotId: "41",
      rowIndex: 1,
      included: true,
      clubSummaryId: 21,
      measurements: MEASUREMENTS,
    }),
    buildModeledShotFlight({
      shotId: "42",
      rowIndex: 2,
      included: true,
      clubSummaryId: 21,
      measurements: MEASUREMENTS,
    }),
    buildModeledShotFlight({
      shotId: "43",
      rowIndex: 3,
      included: true,
      clubSummaryId: 22,
      measurements: MEASUREMENTS,
    }),
  ];
  const rendererFlights = toGolfShotVizFlights(flights, {
    colorsBySummaryId: colors,
    namesBySummaryId: new Map([
      [21, "3 Wood · Mens"],
      [22, "Unknown Club"],
    ]),
  });
  const reversedRendererFlights = toGolfShotVizFlights(
    [...flights].reverse(),
    { colorsBySummaryId: colors },
  );
  const selectedShotId = "42";

  assert.deepEqual(
    rendererFlights.map(({ id, color, clubSummaryId }) => ({
      id,
      color,
      clubSummaryId,
    })),
    [
      { id: "41", color: "green", clubSummaryId: 21 },
      { id: "42", color: "green", clubSummaryId: 21 },
      { id: "43", color: "blue", clubSummaryId: 22 },
    ],
  );
  assert.equal(
    rendererFlights.find((flight) => flight.id === selectedShotId)?.color,
    "green",
  );
  assert.deepEqual(
    new Map(reversedRendererFlights.map(({ id, color }) => [id, color])),
    new Map(rendererFlights.map(({ id, color }) => [id, color])),
  );
  assert.equal(rendererFlights[0]?.meta?.club, "3 Wood · Mens");
  assert.equal(rendererFlights[2]?.meta?.club, "Unknown Club");
});

test("club filter supports additive, removable, and normalized selections", () => {
  const ids = [21, 22, 23];
  assert.equal(toggleClubFilterSelection(null, ids, 21)?.has(21), true);

  const onlyFirst = toggleClubFilterSelection(null, ids, 21);
  const firstAndSecond = toggleClubFilterSelection(onlyFirst, ids, 22);
  assert.deepEqual([...firstAndSecond!].sort(), [21, 22]);

  const secondOnly = toggleClubFilterSelection(firstAndSecond, ids, 21);
  assert.deepEqual([...secondOnly!], [22]);
  assert.equal(toggleClubFilterSelection(secondOnly, ids, 22), null);
  assert.equal(toggleClubFilterSelection(firstAndSecond, ids, null), null);
  assert.equal(
    toggleClubFilterSelection(
      toggleClubFilterSelection(
        toggleClubFilterSelection(null, ids, 21),
        ids,
        22,
      ),
      ids,
      23,
    ),
    null,
  );
  assert.equal(toggleClubFilterSelection(null, [21], 21), null);
});

test("club legend contains only visible renderable clubs", () => {
  const flights = [
    buildModeledShotFlight({
      shotId: "61",
      rowIndex: 1,
      included: true,
      clubSummaryId: 21,
      measurements: MEASUREMENTS,
    }),
    buildModeledShotFlight({
      shotId: "62",
      rowIndex: 2,
      included: true,
      clubSummaryId: 22,
      measurements: MEASUREMENTS,
    }),
    buildModeledShotFlight({
      shotId: "63",
      rowIndex: 3,
      included: true,
      clubSummaryId: 23,
      measurements: { ...MEASUREMENTS, carryYd: null },
    }),
  ];

  assert.deepEqual(
    buildFittingClubLegend(
      flights,
      [{ id: 21 }, { id: 22 }, { id: 23 }],
      new Map([[21, "green"], [22, "gold"], [23, "blue"]]),
      new Map([[21, "3 Wood"], [22, "5 Wood"], [23, "Unknown Club"]]),
    ),
    [
      { summaryId: 21, label: "3 Wood", color: "green" },
      { summaryId: 22, label: "5 Wood", color: "gold" },
    ],
  );
});
