export interface TrackManSourceUnitMetadata {
  siUnit: string | null;
  conversionFactor: number | null;
  displayUnit: string | null;
}

export interface MeasuredShotV1 {
  contractVersion: 1;
  source: {
    provider: "trackman";
    exportFormat: string;
    sheetName: string | null;
    selectedUnitSystem: string | null;
    mappingVersion: 1;
    sourceUnits: Record<string, TrackManSourceUnitMetadata>;
    lateralSignConvention: "unknown";
    normalizationIssues: string[];
  };
  club: {
    type: string | null;
    tags: string[];
  };
  measurements: {
    clubSpeedMph: number | null;
    ballSpeedMph: number | null;
    launchAngleDeg: number | null;
    launchDirectionDeg: number | null;
    spinRateRpm: number | null;
    spinAxisDeg: number | null;
    apexDistanceYd: number | null;
    apexHeightYd: number | null;
    apexSideYd: number | null;
    carryYd: number | null;
    carrySideYd: number | null;
    landingAngleDeg: number | null;
    carryBallSpeedMph: number | null;
    hangTimeS: number | null;
    totalYd: number | null;
    totalSideYd: number | null;
    attackAngleDeg: number | null;
    clubPathDeg: number | null;
    faceAngleDeg: number | null;
    dynamicLoftDeg: number | null;
    smashFactor: number | null;
  };
}

export interface TrackManMeasuredShotInput {
  headers: readonly string[];
  shotRow: readonly (string | null)[];
  siUnitRow: readonly (string | null)[];
  conversionFactorRow: readonly (string | null)[];
  displayUnitRow: readonly (string | null)[];
  exportFormat: string;
  selectedUnitSystem: string | null;
}

type MeasurementKey = keyof MeasuredShotV1["measurements"];
type MeasurementKind = "speed" | "distance" | "angle" | "spin" | "time" | "ratio";

interface MeasurementDefinition {
  sourceHeader: string;
  key: MeasurementKey;
  kind: MeasurementKind;
}

const MEASUREMENT_DEFINITIONS: readonly MeasurementDefinition[] = [
  { sourceHeader: "Measurement.ClubSpeed", key: "clubSpeedMph", kind: "speed" },
  { sourceHeader: "Measurement.BallSpeed", key: "ballSpeedMph", kind: "speed" },
  { sourceHeader: "Measurement.LaunchAngle", key: "launchAngleDeg", kind: "angle" },
  { sourceHeader: "Measurement.LaunchDirection", key: "launchDirectionDeg", kind: "angle" },
  { sourceHeader: "Measurement.SpinRate", key: "spinRateRpm", kind: "spin" },
  { sourceHeader: "Measurement.SpinAxis", key: "spinAxisDeg", kind: "angle" },
  { sourceHeader: "MaxHeight.Dist", key: "apexDistanceYd", kind: "distance" },
  { sourceHeader: "MaxHeight.Height", key: "apexHeightYd", kind: "distance" },
  { sourceHeader: "MaxHeight.Side", key: "apexSideYd", kind: "distance" },
  { sourceHeader: "Measurement.Carry", key: "carryYd", kind: "distance" },
  { sourceHeader: "Measurement.CarrySide", key: "carrySideYd", kind: "distance" },
  { sourceHeader: "Measurement.LandingAngle", key: "landingAngleDeg", kind: "angle" },
  { sourceHeader: "Measurement.CarryBallSpeed", key: "carryBallSpeedMph", kind: "speed" },
  { sourceHeader: "Measurement.HangTime", key: "hangTimeS", kind: "time" },
  { sourceHeader: "Measurement.Total", key: "totalYd", kind: "distance" },
  { sourceHeader: "Measurement.TotalSide", key: "totalSideYd", kind: "distance" },
  { sourceHeader: "Measurement.AttackAngle", key: "attackAngleDeg", kind: "angle" },
  { sourceHeader: "Measurement.ClubPath", key: "clubPathDeg", kind: "angle" },
  { sourceHeader: "Measurement.FaceAngle", key: "faceAngleDeg", kind: "angle" },
  { sourceHeader: "Measurement.DynamicLoft", key: "dynamicLoftDeg", kind: "angle" },
  { sourceHeader: "Measurement.SmashFactor", key: "smashFactor", kind: "ratio" },
];

const EXPECTED_FACTORS: Record<MeasurementKind, Record<string, number>> = {
  speed: {
    "[m/s]→[m/s]": 1,
    "[m/s]→[mph]": 2.23694,
    "[m/s]→[kph]": 3.6,
  },
  distance: {
    "[m]→[m]": 1,
    "[m]→[yrd]": 1.09361,
    "[m]→[ft]": 3.28084,
  },
  angle: { "[deg]→[deg]": 1 },
  spin: { "[rpm]→[rpm]": 1 },
  time: { "[s]→[s]": 1 },
  ratio: { "→": 1 },
};

const CANONICAL_SCALES: Record<MeasurementKind, Record<string, number>> = {
  speed: {
    "[m/s]": 2.2369362920544,
    "[mph]": 1,
    "[kph]": 0.621371192237334,
  },
  distance: {
    "[m]": 1.0936132983377078,
    "[yrd]": 1,
    "[ft]": 1 / 3,
  },
  angle: { "[deg]": 1 },
  spin: { "[rpm]": 1 },
  time: { "[s]": 1 },
  ratio: { "": 1 },
};

function trimmedCell(row: readonly (string | null)[], index: number): string | null {
  const value = row[index]?.trim();
  return value ? value : null;
}

function finiteNumber(value: string | null): number | null {
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function factorMatches(actual: number | null, expected: number): boolean {
  return actual !== null && Math.abs(actual - expected) <= 0.00002;
}

function canonicalScale(
  kind: MeasurementKind,
  units: TrackManSourceUnitMetadata,
): number | null {
  const unitKey = `${units.siUnit ?? ""}→${units.displayUnit ?? ""}`;
  const expectedFactor = EXPECTED_FACTORS[kind][unitKey];
  if (expectedFactor === undefined || !factorMatches(units.conversionFactor, expectedFactor)) {
    return null;
  }

  if (kind === "ratio") {
    return units.siUnit === null && units.displayUnit === null
      ? CANONICAL_SCALES.ratio[""]
      : null;
  }

  if (units.displayUnit === null) return null;
  return CANONICAL_SCALES[kind][units.displayUnit] ?? null;
}

export function createTrackManMeasuredShot(
  input: TrackManMeasuredShotInput,
): MeasuredShotV1 {
  const measurements = Object.fromEntries(
    MEASUREMENT_DEFINITIONS.map(({ key }) => [key, null]),
  ) as MeasuredShotV1["measurements"];
  const sourceUnits: Record<string, TrackManSourceUnitMetadata> = {};
  const normalizationIssues: string[] = [];

  for (const definition of MEASUREMENT_DEFINITIONS) {
    const columnIndex = input.headers.indexOf(definition.sourceHeader);
    if (columnIndex < 0) continue;

    const units: TrackManSourceUnitMetadata = {
      siUnit: trimmedCell(input.siUnitRow, columnIndex),
      conversionFactor: finiteNumber(trimmedCell(input.conversionFactorRow, columnIndex)),
      displayUnit: trimmedCell(input.displayUnitRow, columnIndex),
    };
    sourceUnits[definition.sourceHeader] = units;

    const sourceValue = finiteNumber(trimmedCell(input.shotRow, columnIndex));
    if (sourceValue === null) continue;

    const scale = canonicalScale(definition.kind, units);
    if (scale === null) {
      normalizationIssues.push(
        `${definition.sourceHeader} has missing, unsupported, or inconsistent unit metadata.`,
      );
      continue;
    }

    measurements[definition.key] = sourceValue * scale;
  }

  const clubIndex = input.headers.indexOf("Club.Type");
  const tagsIndex = input.headers.indexOf("Tags");
  const rawTags = tagsIndex >= 0 ? trimmedCell(input.shotRow, tagsIndex) : null;

  return {
    contractVersion: 1,
    source: {
      provider: "trackman",
      exportFormat: input.exportFormat,
      sheetName: "Result",
      selectedUnitSystem: input.selectedUnitSystem,
      mappingVersion: 1,
      sourceUnits,
      lateralSignConvention: "unknown",
      normalizationIssues,
    },
    club: {
      type: clubIndex >= 0 ? trimmedCell(input.shotRow, clubIndex) : null,
      tags: rawTags
        ? rawTags.split(",").map((tag) => tag.trim()).filter(Boolean)
        : [],
    },
    measurements,
  };
}
