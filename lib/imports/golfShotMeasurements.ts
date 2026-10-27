import type { MeasuredShotV1 } from "./trackmanMeasurements";

export type NormalizedGolfShotMeasurements = MeasuredShotV1["measurements"];

export interface GolfShotMeasurements {
  contractVersion: number | null;
  sourceProvider: string | null;
  hasNormalizedMeasurements: boolean;
  clubType: string | null;
  tags: string[];
  lateralSignConvention: string | null;
  measurements: NormalizedGolfShotMeasurements;
  // These retain legacy summary semantics and must not be treated as canonical units.
  summaryMetrics: {
    clubSpeed: number | null;
    ballSpeed: number | null;
    spinRate: number | null;
    maxHeight: number | null;
    carry: number | null;
    total: number | null;
  };
  legacyReviewMetrics: {
    clubSpeed: string | null;
    ballSpeed: string | null;
    spinRate: string | null;
    maxHeight: string | null;
    carry: string | null;
    total: string | null;
  };
}

export interface ShotReviewMeasurements {
  contractVersion: number | null;
  sourceProvider: string | null;
  hasNormalizedMeasurements: boolean;
  lateralSignConvention: string | null;
  measurements: NormalizedGolfShotMeasurements;
}

const MEASUREMENT_KEYS = [
  "clubSpeedMph",
  "ballSpeedMph",
  "launchAngleDeg",
  "launchDirectionDeg",
  "spinRateRpm",
  "spinAxisDeg",
  "apexDistanceYd",
  "apexHeightYd",
  "apexSideYd",
  "carryYd",
  "carrySideYd",
  "landingAngleDeg",
  "carryBallSpeedMph",
  "hangTimeS",
  "totalYd",
  "totalSideYd",
  "attackAngleDeg",
  "clubPathDeg",
  "faceAngleDeg",
  "dynamicLoftDeg",
  "smashFactor",
] as const satisfies readonly (keyof NormalizedGolfShotMeasurements)[];

const EMPTY_MEASUREMENTS: NormalizedGolfShotMeasurements = {
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

type RawObject = Record<string, unknown>;

function isObject(value: unknown): value is RawObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteContractNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isMeasuredShotSource(
  value: unknown,
): value is MeasuredShotV1["source"] {
  if (
    !isObject(value) ||
    value.provider !== "trackman" ||
    typeof value.exportFormat !== "string" ||
    (value.sheetName !== null && typeof value.sheetName !== "string") ||
    (value.selectedUnitSystem !== null &&
      typeof value.selectedUnitSystem !== "string") ||
    value.mappingVersion !== 1 ||
    value.lateralSignConvention !== "unknown" ||
    !Array.isArray(value.normalizationIssues) ||
    !value.normalizationIssues.every((issue) => typeof issue === "string") ||
    !isObject(value.sourceUnits)
  ) {
    return false;
  }

  return Object.values(value.sourceUnits).every(
    (unit) =>
      isObject(unit) &&
      (unit.siUnit === null || typeof unit.siUnit === "string") &&
      finiteContractNumber(unit.conversionFactor) &&
      (unit.displayUnit === null || typeof unit.displayUnit === "string"),
  );
}

function isMeasuredShotClub(value: unknown): value is MeasuredShotV1["club"] {
  return (
    isObject(value) &&
    (value.type === null || typeof value.type === "string") &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === "string")
  );
}

function isNormalizedMeasurements(
  value: unknown,
): value is MeasuredShotV1["measurements"] {
  return (
    isObject(value) &&
    MEASUREMENT_KEYS.every((key) => finiteContractNumber(value[key]))
  );
}

function readValidMeasuredShot(value: unknown): MeasuredShotV1 | null {
  if (
    !isObject(value) ||
    value.contractVersion !== 1 ||
    !isMeasuredShotSource(value.source) ||
    !isMeasuredShotClub(value.club) ||
    !isNormalizedMeasurements(value.measurements)
  ) {
    return null;
  }

  return {
    contractVersion: 1,
    source: value.source,
    club: value.club,
    measurements: value.measurements,
  };
}

function legacyNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === "" || text === "—" || text === "-" || text.toLowerCase() === "nan") {
    return null;
  }
  const number = Number.parseFloat(text);
  return Number.isFinite(number) ? number : null;
}

function legacyText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") return value;
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

function stringTags(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((tag): tag is string => typeof tag === "string")
    : [];
}

export function readGolfShotMeasurements(rawData: unknown): GolfShotMeasurements {
  const raw = isObject(rawData) ? rawData : {};
  const measuredShot = readValidMeasuredShot(raw.measuredShot);
  const legacyTags = stringTags(raw.tags);
  const clubType =
    measuredShot?.club.type ??
    legacyText(raw["Club.Type"]);
  const tags = measuredShot?.club.tags ?? legacyTags;

  const legacyReviewMetrics = {
    clubSpeed: legacyText(raw["Measurement.ClubSpeed"]),
    ballSpeed: legacyText(raw["Measurement.BallSpeed"]),
    spinRate: legacyText(raw["Measurement.SpinRate"]),
    maxHeight: legacyText(raw["MaxHeight.Height"]),
    carry: legacyText(raw["Measurement.Carry"]),
    total: legacyText(raw["Measurement.Total"]),
  };

  const summaryMetrics = {
    clubSpeed:
      legacyNumber(raw["Measurement.ClubSpeed"]) ?? measuredShot?.measurements.clubSpeedMph ?? null,
    ballSpeed:
      legacyNumber(raw["Measurement.BallSpeed"]) ?? measuredShot?.measurements.ballSpeedMph ?? null,
    spinRate:
      legacyNumber(raw["Measurement.SpinRate"]) ?? measuredShot?.measurements.spinRateRpm ?? null,
    maxHeight:
      legacyNumber(raw["MaxHeight.Height"]) ?? measuredShot?.measurements.apexHeightYd ?? null,
    carry:
      legacyNumber(raw["Measurement.Carry"]) ?? measuredShot?.measurements.carryYd ?? null,
    total:
      legacyNumber(raw["Measurement.Total"]) ?? measuredShot?.measurements.totalYd ?? null,
  };

  const legacyTrackManRow = [
    "Club.Type",
    "Measurement.ClubSpeed",
    "Measurement.BallSpeed",
    "Measurement.SpinRate",
    "MaxHeight.Height",
    "Measurement.Carry",
    "Measurement.Total",
  ].some((key) => Object.hasOwn(raw, key));

  return {
    contractVersion: measuredShot?.contractVersion ?? null,
    sourceProvider: measuredShot?.source.provider ?? (legacyTrackManRow ? "trackman" : null),
    hasNormalizedMeasurements: measuredShot !== null,
    clubType,
    tags,
    lateralSignConvention: measuredShot?.source.lateralSignConvention ?? null,
    measurements: measuredShot?.measurements ?? EMPTY_MEASUREMENTS,
    summaryMetrics,
    legacyReviewMetrics,
  };
}

export function getShotReviewMeasurements(
  shot: GolfShotMeasurements,
): ShotReviewMeasurements {
  return {
    contractVersion: shot.contractVersion,
    sourceProvider: shot.sourceProvider,
    hasNormalizedMeasurements: shot.hasNormalizedMeasurements,
    lateralSignConvention: shot.lateralSignConvention,
    measurements: shot.measurements,
  };
}

export function getShotReviewShotData(rawData: unknown) {
  const shot = readGolfShotMeasurements(rawData);
  return {
    clubType: shot.clubType,
    tags: shot.tags,
    ...shot.legacyReviewMetrics,
    measurementData: getShotReviewMeasurements(shot),
  };
}
