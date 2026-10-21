import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateTrackManClubGroups,
  type ClubSummaryInput,
} from "@/lib/imports/trackmanAggregation";
import {
  calculateIncludedTrackManSummaryMetrics,
  type TrackManAssociatedShot,
} from "@/lib/imports/trackmanClubSummaryPersistence";
import {
  isStagedTrackManBatch,
  isTrackManShotAssociatedWithSummary,
  parsePositiveRouteId,
} from "@/lib/imports/trackmanShotReview";

function shot(
  clubType: string,
  tags: string[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    "Club.Type": clubType,
    tags,
    "Measurement.ClubSpeed": "80",
    "Measurement.BallSpeed": "110",
    "Measurement.SpinRate": "2500",
    "MaxHeight.Height": "25",
    "Measurement.Carry": "150",
    "Measurement.Total": "160",
    ...overrides,
  };
}

function includedShot(
  rawData: Record<string, unknown>,
  includedInSummary: boolean | null = true,
): TrackManAssociatedShot {
  return { rawData, includedInSummary };
}

test("groups normalized club and tags together and keeps distinct groups separate", () => {
  const groups = aggregateTrackManClubGroups([
    shot("  6 Iron ", [" B ", "A"]),
    shot("6 Iron", ["A", "B"]),
    shot("6 Iron", ["A"]),
    shot("7 Iron", ["A", "B"]),
  ]);

  const sixIronAb = groups.find(
    ({ summary }) => summary.clubName === "6 Iron" && summary.tags.join(",") === "A,B",
  );
  assert.ok(sixIronAb);
  assert.deepEqual(sixIronAb.rowIndexes, [0, 1]);
  assert.equal(sixIronAb.summary.shotCount, 2);
  assert.equal(groups.length, 3);
});

test("only included shots contribute and toggling exclusion recalculates averages", () => {
  const shots = [
    includedShot(shot("Driver", [], { "Measurement.Carry": "200" })),
    includedShot(shot("Driver", [], { "Measurement.Carry": "100" })),
  ];

  const initial = calculateIncludedTrackManSummaryMetrics(shots);
  assert.equal(initial.shotCount, 2);
  assert.equal(initial.avgCarry, 150);

  shots[1]!.includedInSummary = false;
  const recalculated = calculateIncludedTrackManSummaryMetrics(shots);
  assert.equal(recalculated.shotCount, 1);
  assert.equal(recalculated.avgCarry, 200);
});

test("missing and invalid measurements are ignored rather than treated as zero", () => {
  const metrics = calculateIncludedTrackManSummaryMetrics([
    includedShot(
      shot("Driver", [], {
        "Measurement.ClubSpeed": "",
        "Measurement.BallSpeed": "not a number",
        "Measurement.SpinRate": "—",
        "MaxHeight.Height": null,
        "Measurement.Carry": "200",
        "Measurement.Total": "NaN",
      }),
    ),
    includedShot(
      shot("Driver", [], {
        "Measurement.ClubSpeed": "100",
        "Measurement.BallSpeed": "120",
        "Measurement.SpinRate": "2400",
        "MaxHeight.Height": "30",
        "Measurement.Carry": "—",
        "Measurement.Total": "170",
      }),
    ),
  ]);

  assert.equal(metrics.shotCount, 2);
  assert.equal(metrics.avgClubSpeed, 100);
  assert.equal(metrics.validClubSpeedCount, 1);
  assert.equal(metrics.avgBallSpeed, 120);
  assert.equal(metrics.validBallSpeedCount, 1);
  assert.equal(metrics.avgSpinRate, 2400);
  assert.equal(metrics.validSpinRateCount, 1);
  assert.equal(metrics.avgMaxHeight, 30);
  assert.equal(metrics.validMaxHeightCount, 1);
  assert.equal(metrics.avgCarry, 200);
  assert.equal(metrics.validCarryCount, 1);
  assert.equal(metrics.avgTotal, 170);
  assert.equal(metrics.validTotalCount, 1);
});

test("all excluded shots retain a zero count and null averages", () => {
  const metrics = calculateIncludedTrackManSummaryMetrics([
    includedShot(shot("Driver", []), false),
    includedShot(shot("Driver", []), false),
  ]);

  assert.deepEqual(metrics, {
    shotCount: 0,
    avgClubSpeed: null,
    avgBallSpeed: null,
    avgSpinRate: null,
    avgMaxHeight: null,
    avgCarry: null,
    avgTotal: null,
    validClubSpeedCount: 0,
    validBallSpeedCount: 0,
    validSpinRateCount: 0,
    validMaxHeightCount: 0,
    validCarryCount: 0,
    validTotalCount: 0,
  });
});

test("recalculation payload contains only derived fields and preserves review state", () => {
  const staffState = {
    id: 12,
    clubName: "Edited name",
    tags: ["reviewed"],
    includeInReport: false,
    linkedToSummaryId: 9,
    estimatedPrice: 499,
    isManuallyEdited: true,
  };
  const metrics = calculateIncludedTrackManSummaryMetrics([
    includedShot(shot("Driver", [])),
  ]);
  const updated = { ...staffState, ...metrics };

  assert.equal(updated.clubName, staffState.clubName);
  assert.deepEqual(updated.tags, staffState.tags);
  assert.equal(updated.includeInReport, staffState.includeInReport);
  assert.equal(updated.linkedToSummaryId, staffState.linkedToSummaryId);
  assert.equal(updated.estimatedPrice, staffState.estimatedPrice);
  assert.equal(updated.isManuallyEdited, staffState.isManuallyEdited);
  assert.deepEqual(Object.keys(metrics).sort(), [
    "avgBallSpeed",
    "avgCarry",
    "avgClubSpeed",
    "avgMaxHeight",
    "avgSpinRate",
    "avgTotal",
    "shotCount",
    "validBallSpeedCount",
    "validCarryCount",
    "validClubSpeedCount",
    "validMaxHeightCount",
    "validSpinRateCount",
    "validTotalCount",
  ]);
});

test("staged TrackMan and shot-summary ownership checks reject invalid associations", () => {
  assert.equal(
    isStagedTrackManBatch({ parserMode: "trackman-result", demoSessionId: null }),
    true,
  );
  assert.equal(
    isStagedTrackManBatch({ parserMode: "generic", demoSessionId: null }),
    false,
  );
  assert.equal(
    isStagedTrackManBatch({ parserMode: "trackman-result", demoSessionId: 4 }),
    false,
  );

  assert.equal(
    isTrackManShotAssociatedWithSummary(3, 8, {
      importBatchId: 3,
      clubSummaryId: 8,
    }),
    true,
  );
  assert.equal(
    isTrackManShotAssociatedWithSummary(3, 8, {
      importBatchId: 4,
      clubSummaryId: 8,
    }),
    false,
  );
  assert.equal(
    isTrackManShotAssociatedWithSummary(3, 8, {
      importBatchId: 3,
      clubSummaryId: 9,
    }),
    false,
  );
});

test("route ID parser accepts positive safe integers only", () => {
  assert.equal(parsePositiveRouteId("12"), 12);
  assert.equal(parsePositiveRouteId("0"), null);
  assert.equal(parsePositiveRouteId("-2"), null);
  assert.equal(parsePositiveRouteId("1.2"), null);
  assert.equal(parsePositiveRouteId("9007199254740992"), null);
});

test("legacy and generic rows remain unassociated unless explicitly mapped", () => {
  const untouchedLegacyRow = {
    importBatchId: 1,
    clubSummaryId: null,
    includedInSummary: null,
  };
  assert.equal(
    isTrackManShotAssociatedWithSummary(1, 5, untouchedLegacyRow),
    false,
  );
});

test("aggregation summary shape remains unchanged for existing callers", () => {
  const group = aggregateTrackManClubGroups([shot("Driver", [])])[0];
  assert.ok(group);
  const summary: ClubSummaryInput = group.summary;
  assert.equal(summary.clubName, "Driver");
  assert.deepEqual(Object.keys(summary).sort(), [
    "avgBallSpeed",
    "avgCarry",
    "avgClubSpeed",
    "avgMaxHeight",
    "avgSpinRate",
    "avgTotal",
    "clubName",
    "originalClubName",
    "shotCount",
    "tags",
    "validBallSpeedCount",
    "validCarryCount",
    "validClubSpeedCount",
    "validMaxHeightCount",
    "validSpinRateCount",
    "validTotalCount",
  ]);
});
