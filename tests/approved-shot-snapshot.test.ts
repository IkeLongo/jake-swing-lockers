import test from "node:test";
import assert from "node:assert/strict";
import { buildApprovedShotSnapshot } from "@/lib/imports/approvedShotSnapshot";
import { createTrackManMeasuredShot } from "@/lib/imports/trackmanMeasurements";

function measuredShot() {
  return createTrackManMeasuredShot({
    headers: [
      "Measurement.Carry",
      "Measurement.CarrySide",
      "MaxHeight.Dist",
      "MaxHeight.Height",
      "MaxHeight.Side",
      "Measurement.LaunchAngle",
      "Measurement.LaunchDirection",
      "Measurement.LandingAngle",
      "Measurement.Total",
      "Measurement.TotalSide",
    ],
    shotRow: ["150", "-9", "80", "30", "-6", "0", "-2", "45", "160", "0"],
    siUnitRow: ["[m]", "[m]", "[m]", "[m]", "[m]", "[deg]", "[deg]", "[deg]", "[m]", "[m]"],
    conversionFactorRow: ["1.09361", "3.28084", "1.09361", "3.28084", "3.28084", "1", "1", "1", "1.09361", "3.28084"],
    displayUnitRow: ["[yrd]", "[ft]", "[yrd]", "[ft]", "[ft]", "[deg]", "[deg]", "[deg]", "[yrd]", "[ft]"],
    exportFormat: "xlsx",
    selectedUnitSystem: "US",
  });
}

function row(
  overrides: Partial<{
    id: number;
    importBatchId: number;
    clubSummaryId: number | null;
    rowIndex: number;
    includedInSummary: boolean | null;
    rawData: unknown;
  }> = {},
) {
  return {
    id: 1,
    importBatchId: 10,
    clubSummaryId: 20,
    rowIndex: 1,
    includedInSummary: true,
    rawData: { measuredShot: measuredShot(), secret: "not copied" },
    ...overrides,
  };
}

function source(rows: ReturnType<typeof row>[]) {
  return {
    batch: { id: 10, parserMode: "trackman-result" },
    summary: { id: 20, importBatchId: 10 },
    rows,
  };
}

test("captures only normalized visualization measurements and source identifiers", () => {
  const snapshot = buildApprovedShotSnapshot(source([row()]));
  assert.deepEqual(snapshot, {
    version: 1,
    sourceBatchId: 10,
    sourceSummaryId: 20,
    shots: [{
      sourceRowId: 1,
      lateralSignConvention: "unknown",
      measurements: {
        carryYd: 150,
        carrySideYd: -3,
        apexDistanceYd: 80,
        apexHeightYd: 10,
        apexSideYd: -2,
        launchAngleDeg: 0,
        launchDirectionDeg: -2,
        landingAngleDeg: 45,
        totalYd: 160,
        totalSideYd: 0,
      },
    }],
  });
});

test("filters by batch, summary and inclusion, then sorts by row index and ID", () => {
  const rows = [
    row({ id: 9, rowIndex: 2, includedInSummary: null }),
    row({ id: 4, rowIndex: 1 }),
    row({ id: 3, rowIndex: 1 }),
    row({ id: 5, includedInSummary: false }),
    row({ id: 6, importBatchId: 11 }),
    row({ id: 7, clubSummaryId: 21 }),
    row({ id: 8, importBatchId: 11, clubSummaryId: null }),
  ];
  assert.deepEqual(
    buildApprovedShotSnapshot(source(rows))?.shots.map((shot) => shot.sourceRowId),
    [3, 4, 9],
  );
  assert.deepEqual(
    buildApprovedShotSnapshot(source([...rows].reverse()))?.shots.map((shot) => shot.sourceRowId),
    [3, 4, 9],
  );
  assert.equal(rows[0]?.id, 9);
});

test("preserves missing measurements and does not infer a lateral direction", () => {
  const shot = measuredShot();
  shot.measurements.carryYd = null;
  shot.measurements.apexSideYd = null;
  const snapshot = buildApprovedShotSnapshot(source([row({ rawData: { measuredShot: shot } })]));
  assert.equal(snapshot?.shots[0]?.measurements.carryYd, null);
  assert.equal(snapshot?.shots[0]?.measurements.apexSideYd, null);
  assert.equal(snapshot?.shots[0]?.measurements.carrySideYd, -3);
  assert.equal(snapshot?.shots[0]?.lateralSignConvention, "unknown");
});

test("malformed, non-finite and legacy shots are omitted rather than guessed", () => {
  const invalid = measuredShot();
  invalid.measurements.carryYd = Number.POSITIVE_INFINITY;
  const missing = measuredShot();
  const incompleteMeasurements: Partial<typeof missing.measurements> = { ...missing.measurements };
  delete incompleteMeasurements.carryYd;
  const snapshot = buildApprovedShotSnapshot(source([
    row({ id: 1, rawData: { measuredShot: invalid, "Measurement.Carry": "200" } }),
    row({ id: 2, rawData: { measuredShot: { ...missing, measurements: incompleteMeasurements } } }),
    row({ id: 3, rawData: { measuredShot: "malformed" } }),
    row({ id: 4, rawData: { "Measurement.Carry": "200" } }),
    row({ id: 5 }),
  ]));
  assert.deepEqual(snapshot?.shots.map((shot) => shot.sourceRowId), [5]);
});

test("distinguishes verified empty snapshots from unavailable provenance", () => {
  assert.deepEqual(buildApprovedShotSnapshot(source([row({ includedInSummary: false })])), {
    version: 1,
    sourceBatchId: 10,
    sourceSummaryId: 20,
    shots: [],
  });
  assert.deepEqual(buildApprovedShotSnapshot(source([]))?.shots, []);
  assert.equal(buildApprovedShotSnapshot(null), null);
  assert.equal(buildApprovedShotSnapshot({
    ...source([]),
    batch: { id: 10, parserMode: "generic" },
  }), null);
  assert.equal(buildApprovedShotSnapshot(source([
    row(),
    row({ id: 2, clubSummaryId: null }),
  ])), null);
  assert.throws(
    () => buildApprovedShotSnapshot({
      ...source([]),
      summary: { id: 20, importBatchId: 11 },
    }),
    /summary does not belong/,
  );
});
