import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { aggregateTrackManClubGroups } from "@/lib/imports/trackmanAggregation";
import { parseFileBuffer } from "@/lib/imports/parseFile";
import type { MeasuredShotV1 } from "@/lib/imports/trackmanMeasurements";

const FIELD_UNITS: Record<
  string,
  { si: string | null; factor: string; display: string | null }
> = {
  "Measurement.ClubSpeed": { si: "[m/s]", factor: "1", display: "[m/s]" },
  "Measurement.BallSpeed": { si: "[m/s]", factor: "2.23694", display: "[mph]" },
  "Measurement.LaunchAngle": { si: "[deg]", factor: "1", display: "[deg]" },
  "Measurement.LaunchDirection": { si: "[deg]", factor: "1", display: "[deg]" },
  "Measurement.SpinRate": { si: "[rpm]", factor: "1", display: "[rpm]" },
  "Measurement.SpinAxis": { si: "[deg]", factor: "1", display: "[deg]" },
  "MaxHeight.Dist": { si: "[m]", factor: "1", display: "[m]" },
  "MaxHeight.Height": { si: "[m]", factor: "3.28084", display: "[ft]" },
  "MaxHeight.Side": { si: "[m]", factor: "3.28084", display: "[ft]" },
  "Measurement.Carry": { si: "[m]", factor: "1.09361", display: "[yrd]" },
  "Measurement.CarrySide": { si: "[m]", factor: "3.28084", display: "[ft]" },
  "Measurement.LandingAngle": { si: "[deg]", factor: "1", display: "[deg]" },
  "Measurement.CarryBallSpeed": { si: "[m/s]", factor: "2.23694", display: "[mph]" },
  "Measurement.HangTime": { si: "[s]", factor: "1", display: "[s]" },
  "Measurement.Total": { si: "[m]", factor: "1.09361", display: "[yrd]" },
  "Measurement.TotalSide": { si: "[m]", factor: "3.28084", display: "[ft]" },
  "Measurement.AttackAngle": { si: "[deg]", factor: "1", display: "[deg]" },
  "Measurement.ClubPath": { si: "[deg]", factor: "1", display: "[deg]" },
  "Measurement.FaceAngle": { si: "[deg]", factor: "1", display: "[deg]" },
  "Measurement.DynamicLoft": { si: "[deg]", factor: "1", display: "[deg]" },
  "Measurement.SmashFactor": { si: null, factor: "1", display: null },
};

const HEADERS = [
  "Club.Type",
  ...Object.keys(FIELD_UNITS),
  "Tags",
];

function buildTrackManWorkbook(
  overrides: Record<string, string | null> = {},
  unitOverrides: Record<
    string,
    Partial<{ si: string | null; factor: string; display: string | null }>
  > = {},
): Buffer {
  const siUnits = HEADERS.map((header) => FIELD_UNITS[header]?.si ?? null);
  const conversionFactors = HEADERS.map(
    (header) => FIELD_UNITS[header]?.factor ?? null,
  );
  const displayUnits = HEADERS.map(
    (header) => FIELD_UNITS[header]?.display ?? null,
  );
  const shot = HEADERS.map((header) => {
    if (header === "Club.Type") return "7 Iron";
    if (header === "Tags") return "Demo, Fitting";
    if (header in overrides) return overrides[header];
    if (header === "Measurement.ClubSpeed") return "44.704";
    if (header === "Measurement.BallSpeed") return "120";
    if (header === "Measurement.LaunchAngle") return "12.5";
    if (header === "Measurement.LaunchDirection") return "-2.25";
    if (header === "Measurement.SpinRate") return "2500";
    if (header === "Measurement.SpinAxis") return "-14";
    if (header === "MaxHeight.Dist") return "100";
    if (header === "MaxHeight.Height") return "30";
    if (header === "MaxHeight.Side") return "-6";
    if (header === "Measurement.Carry") return "220";
    if (header === "Measurement.CarrySide") return "9";
    if (header === "Measurement.LandingAngle") return "45";
    if (header === "Measurement.CarryBallSpeed") return "90";
    if (header === "Measurement.HangTime") return "5.5";
    if (header === "Measurement.Total") return "250";
    if (header === "Measurement.TotalSide") return "-12";
    if (header === "Measurement.AttackAngle") return "-3";
    if (header === "Measurement.ClubPath") return "2";
    if (header === "Measurement.FaceAngle") return "1";
    if (header === "Measurement.DynamicLoft") return "18";
    if (header === "Measurement.SmashFactor") return "1.47";
    return null;
  });

  for (const [header, units] of Object.entries(unitOverrides)) {
    const index = HEADERS.indexOf(header);
    if (index < 0) continue;
    if ("si" in units) siUnits[index] = units.si ?? null;
    if (units.factor !== undefined) conversionFactors[index] = units.factor;
    if ("display" in units) displayUnits[index] = units.display ?? null;
  }

  const emptyRow = new Array(HEADERS.length).fill(null) as null[];
  const resultSheet = XLSX.utils.aoa_to_sheet([
    emptyRow,
    emptyRow,
    HEADERS,
    new Array(HEADERS.length).fill("TRUE"),
    siUnits,
    conversionFactors,
    displayUnits,
    shot,
  ]);
  const unitsSheet = XLSX.utils.aoa_to_sheet([
    [null, null, null, null, null, "Select Unit:", "US"],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, unitsSheet, "Units");
  XLSX.utils.book_append_sheet(workbook, resultSheet, "Result");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function measuredShotFrom(result: ReturnType<typeof parseFileBuffer>): MeasuredShotV1 {
  const measuredShot = result.rows[0]?.measuredShot;
  assert.ok(measuredShot);
  return measuredShot as MeasuredShotV1;
}

test("parses a versioned normalized shot and preserves legacy flat fields", () => {
  const result = parseFileBuffer(buildTrackManWorkbook(), "session.xlsx");
  const row = result.rows[0];
  assert.ok(row);

  assert.equal(result.parserMode, "trackman-result");
  assert.equal(row["Club.Type"], "7 Iron");
  assert.equal(row["Measurement.ClubSpeed"], "44.704");
  assert.equal(row["Measurement.BallSpeed"], "120");
  assert.equal(row["Measurement.SpinRate"], "2500");
  assert.equal(row["MaxHeight.Height"], "30");
  assert.equal(row["Measurement.Carry"], "220");
  assert.equal(row["Measurement.Total"], "250");
  assert.deepEqual(row.tags, ["Demo", "Fitting"]);

  const measuredShot = measuredShotFrom(result);
  assert.equal(measuredShot.contractVersion, 1);
  assert.equal(measuredShot.source.provider, "trackman");
  assert.equal(measuredShot.source.exportFormat, "xlsx");
  assert.equal(measuredShot.source.sheetName, "Result");
  assert.equal(measuredShot.source.selectedUnitSystem, "US");
  assert.equal(measuredShot.source.mappingVersion, 1);
  assert.equal(measuredShot.source.lateralSignConvention, "unknown");
  assert.deepEqual(measuredShot.source.normalizationIssues, []);
  assert.deepEqual(measuredShot.club, {
    type: "7 Iron",
    tags: ["Demo", "Fitting"],
  });

  const { clubSpeedMph, ...measurementsWithoutClubSpeed } = measuredShot.measurements;
  assert.ok(Math.abs((clubSpeedMph ?? 0) - 100) < 1e-9);
  assert.deepEqual(measurementsWithoutClubSpeed, {
    ballSpeedMph: 120,
    launchAngleDeg: 12.5,
    launchDirectionDeg: -2.25,
    spinRateRpm: 2500,
    spinAxisDeg: -14,
    apexDistanceYd: 100 * 1.0936132983377078,
    apexHeightYd: 10,
    apexSideYd: -2,
    carryYd: 220,
    carrySideYd: 3,
    landingAngleDeg: 45,
    carryBallSpeedMph: 90,
    hangTimeS: 5.5,
    totalYd: 250,
    totalSideYd: -4,
    attackAngleDeg: -3,
    clubPathDeg: 2,
    faceAngleDeg: 1,
    dynamicLoftDeg: 18,
    smashFactor: 1.47,
  });
  assert.equal(
    measuredShot.source.sourceUnits["Measurement.BallSpeed"]?.conversionFactor,
    2.23694,
  );
});

test("normalizes spatial values to yards and preserves lateral signs", () => {
  const { measurements, source } = measuredShotFrom(
    parseFileBuffer(buildTrackManWorkbook(), "session.xlsx"),
  );
  assert.equal(measurements.apexHeightYd, 10);
  assert.equal(measurements.apexSideYd, -2);
  assert.equal(measurements.carrySideYd, 3);
  assert.equal(measurements.totalSideYd, -4);
  assert.equal(measurements.launchDirectionDeg, -2.25);
  assert.equal(measurements.spinAxisDeg, -14);
  assert.equal(source.lateralSignConvention, "unknown");
});

test("invalid and blank numeric values become null rather than zero", () => {
  const result = parseFileBuffer(
    buildTrackManWorkbook({
      "Measurement.LaunchAngle": "",
      "Measurement.LaunchDirection": "not numeric",
      "MaxHeight.Dist": "—",
    }),
    "session.xlsx",
  );
  const { measurements } = measuredShotFrom(result);

  assert.equal(measurements.launchAngleDeg, null);
  assert.equal(measurements.launchDirectionDeg, null);
  assert.equal(measurements.apexDistanceYd, null);
});

test("retains rows populated only with newly normalized measurement columns", () => {
  const result = parseFileBuffer(
    buildTrackManWorkbook({
      "Club.Type": "",
      "Measurement.ClubSpeed": "",
      "Measurement.BallSpeed": "",
      "Measurement.SpinRate": "",
      "MaxHeight.Height": "",
      "Measurement.Carry": "",
      "Measurement.Total": "",
      "Measurement.LaunchAngle": "12.5",
    }),
    "session.xlsx",
  );

  assert.equal(result.rows.length, 1);
  assert.equal(
    measuredShotFrom(result).measurements.launchAngleDeg,
    12.5,
  );
});

test("unsupported or missing unit metadata nulls affected values and records issues", () => {
  const result = parseFileBuffer(
    buildTrackManWorkbook(
      {},
      {
        "Measurement.LaunchAngle": { display: "[rad]" },
        "Measurement.LaunchDirection": { si: null },
      },
    ),
    "session.xlsx",
  );
  const { measurements, source } = measuredShotFrom(result);

  assert.equal(measurements.launchAngleDeg, null);
  assert.equal(measurements.launchDirectionDeg, null);
  assert.equal(source.sourceUnits["Measurement.LaunchAngle"]?.displayUnit, "[rad]");
  assert.deepEqual(source.normalizationIssues, [
    "Measurement.LaunchAngle has missing, unsupported, or inconsistent unit metadata.",
    "Measurement.LaunchDirection has missing, unsupported, or inconsistent unit metadata.",
  ]);
});

test("legacy rawData without measuredShot remains usable by summary aggregation", () => {
  const legacyRawData = {
    "Club.Type": "Driver",
    "Measurement.ClubSpeed": "100",
    "Measurement.BallSpeed": "150",
    "Measurement.SpinRate": "2400",
    "MaxHeight.Height": "30",
    "Measurement.Carry": "220",
    "Measurement.Total": "240",
    tags: [],
  };
  const groups = aggregateTrackManClubGroups([legacyRawData]);

  assert.equal("measuredShot" in legacyRawData, false);
  assert.equal(groups[0]?.summary.avgCarry, 220);
  assert.equal(groups[0]?.summary.avgBallSpeed, 150);
});

test("generic CSV imports do not receive a TrackMan measured-shot contract", () => {
  const result = parseFileBuffer(
    Buffer.from("name,email\nMax,max@example.com\n"),
    "clients.csv",
  );

  assert.equal(result.parserMode, "generic");
  assert.deepEqual(result.rows, [{ name: "Max", email: "max@example.com" }]);
  assert.equal("measuredShot" in (result.rows[0] ?? {}), false);
});
