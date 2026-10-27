import type {
  ClubFlightModel,
  ClubFlightModelOptions,
  FlightBounds,
  FlightMeasurementInput,
  InsufficientFlightReason,
  MeasuredFlightLandmarks,
  ModeledShotFlight,
  ModeledShotInput,
} from "./types";

const DEFAULT_SAMPLES_PER_SEGMENT = 32;
const DERIVATIVE_TOLERANCE = 1e-10;

interface HermiteSegment {
  startX: number;
  endX: number;
  startY: number;
  endY: number;
  startSlope: number;
  endSlope: number;
}

interface VerticalModel {
  originToApex: HermiteSegment;
  apexToCarry: HermiteSegment;
}

function isFiniteNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function finiteOrNull(value: number | null): number | null {
  return isFiniteNumber(value) ? value : null;
}

function measuredLandmarks(
  measurements: FlightMeasurementInput,
): MeasuredFlightLandmarks {
  const apexValues = {
    downrangeYd: finiteOrNull(measurements.apexDistanceYd),
    heightYd: finiteOrNull(measurements.apexHeightYd),
    lateralYd: finiteOrNull(measurements.apexSideYd),
  };
  const apex = Object.values(apexValues).some((value) => value !== null)
    ? { ...apexValues, provenance: "trackman-measured" as const }
    : null;
  const carryValues = {
    downrangeYd: finiteOrNull(measurements.carryYd),
    lateralYd: finiteOrNull(measurements.carrySideYd),
  };
  const carry = Object.values(carryValues).some((value) => value !== null)
    ? { ...carryValues, provenance: "trackman-measured" as const }
    : null;
  const totalValues = {
    downrangeYd: finiteOrNull(measurements.totalYd),
    lateralYd: finiteOrNull(measurements.totalSideYd),
  };
  const total = Object.values(totalValues).some((value) => value !== null)
    ? { ...totalValues, provenance: "trackman-measured" as const }
    : null;

  return {
    origin: {
      downrangeYd: 0,
      heightYd: 0,
      lateralYd: 0,
      provenance: "coordinate-origin",
    },
    apex,
    carry,
    total,
  };
}

function hermiteValue(segment: HermiteSegment, t: number): number {
  if (t === 0) return segment.startY;
  if (t === 1) return segment.endY;

  const t2 = t * t;
  const t3 = t2 * t;
  const span = segment.endX - segment.startX;
  return (
    (2 * t3 - 3 * t2 + 1) * segment.startY +
    (t3 - 2 * t2 + t) * span * segment.startSlope +
    (-2 * t3 + 3 * t2) * segment.endY +
    (t3 - t2) * span * segment.endSlope
  );
}

function derivativeHasRequiredSign(
  segment: HermiteSegment,
  requiredSign: 1 | -1,
): boolean {
  const span = segment.endX - segment.startX;
  const cubic =
    2 * segment.startY -
    2 * segment.endY +
    span * (segment.startSlope + segment.endSlope);
  const quadratic =
    -3 * segment.startY +
    3 * segment.endY -
    span * (2 * segment.startSlope + segment.endSlope);
  const linear = span * segment.startSlope;
  const derivative = (t: number) =>
    requiredSign * (3 * cubic * t * t + 2 * quadratic * t + linear);
  const values = [derivative(0), derivative(1)];

  if (Math.abs(cubic) > Number.EPSILON) {
    const vertex = -quadratic / (3 * cubic);
    if (vertex > 0 && vertex < 1) values.push(derivative(vertex));
  }

  return values.every((value) => value >= -DERIVATIVE_TOLERANCE);
}

function createVerticalModel(
  measurements: FlightMeasurementInput,
): { model: VerticalModel | null; reasons: InsufficientFlightReason[] } {
  const reasons: InsufficientFlightReason[] = [];
  const { apexDistanceYd, apexHeightYd, carryYd, launchAngleDeg, landingAngleDeg } =
    measurements;

  if (!isFiniteNumber(carryYd)) reasons.push("missing-carry");
  if (!isFiniteNumber(apexDistanceYd) || !isFiniteNumber(apexHeightYd)) {
    reasons.push("missing-apex");
  }
  if (!isFiniteNumber(launchAngleDeg)) reasons.push("missing-launch-angle");
  if (!isFiniteNumber(landingAngleDeg)) reasons.push("missing-landing-angle");
  if (
    reasons.length > 0 ||
    !isFiniteNumber(carryYd) ||
    !isFiniteNumber(apexDistanceYd) ||
    !isFiniteNumber(apexHeightYd) ||
    !isFiniteNumber(launchAngleDeg) ||
    !isFiniteNumber(landingAngleDeg)
  ) {
    return { model: null, reasons };
  }

  if (
    carryYd <= 0 ||
    apexDistanceYd <= 0 ||
    apexDistanceYd >= carryYd ||
    apexHeightYd <= 0 ||
    launchAngleDeg < 0 ||
    launchAngleDeg >= 90 ||
    landingAngleDeg < 0 ||
    landingAngleDeg >= 90
  ) {
    return { model: null, reasons: ["invalid-vertical-constraints"] };
  }

  const radians = Math.PI / 180;
  const model: VerticalModel = {
    originToApex: {
      startX: 0,
      endX: apexDistanceYd,
      startY: 0,
      endY: apexHeightYd,
      startSlope: Math.tan(launchAngleDeg * radians),
      endSlope: 0,
    },
    apexToCarry: {
      startX: apexDistanceYd,
      endX: carryYd,
      startY: apexHeightYd,
      endY: 0,
      startSlope: 0,
      endSlope: -Math.tan(landingAngleDeg * radians),
    },
  };

  if (
    !derivativeHasRequiredSign(model.originToApex, 1) ||
    !derivativeHasRequiredSign(model.apexToCarry, -1)
  ) {
    return { model: null, reasons: ["invalid-vertical-constraints"] };
  }

  return { model, reasons: [] };
}

function lateralSlopes(
  originToApex: HermiteSegment,
  apexToCarry: HermiteSegment,
  launchDirectionDeg: number,
): [number, number, number] {
  const firstSpan = originToApex.endX - originToApex.startX;
  const secondSpan = apexToCarry.endX - apexToCarry.startX;
  const launchSlope = Math.tan((launchDirectionDeg * Math.PI) / 180);
  const firstCurvatureWithoutApexSlope =
    (6 * originToApex.startY +
      2 * firstSpan * launchSlope -
      6 * originToApex.endY) /
    (firstSpan * firstSpan);
  const secondLateralChange = apexToCarry.endY - apexToCarry.startY;
  const apexSlope =
    (3 * secondLateralChange / (secondSpan * secondSpan) -
      firstCurvatureWithoutApexSlope) /
    (4 / firstSpan + 3 / secondSpan);
  const carrySlope =
    (1.5 * secondLateralChange) / secondSpan - 0.5 * apexSlope;

  return [launchSlope, apexSlope, carrySlope];
}

function sampleSegment(
  segment: HermiteSegment,
  count: number,
  includeStart: boolean,
): Array<{ downrangeYd: number; value: number }> {
  const points: Array<{ downrangeYd: number; value: number }> = [];
  const firstIndex = includeStart ? 0 : 1;
  for (let index = firstIndex; index <= count; index += 1) {
    const t = index / count;
    points.push({
      downrangeYd:
        t === 0
          ? segment.startX
          : t === 1
            ? segment.endX
            : segment.startX + (segment.endX - segment.startX) * t,
      value: hermiteValue(segment, t),
    });
  }
  return points;
}

function createLateralSegments(
  model: VerticalModel,
  measurements: FlightMeasurementInput,
): { segments: [HermiteSegment, HermiteSegment] | null; reason: ModeledShotFlight["lateralReason"] } {
  const { launchDirectionDeg, apexSideYd, carrySideYd } = measurements;
  if (!isFiniteNumber(launchDirectionDeg)) {
    return { segments: null, reason: "missing-launch-direction" };
  }
  if (launchDirectionDeg <= -90 || launchDirectionDeg >= 90) {
    return { segments: null, reason: "invalid-launch-direction" };
  }
  if (!isFiniteNumber(apexSideYd)) {
    return { segments: null, reason: "missing-apex-side" };
  }
  if (!isFiniteNumber(carrySideYd)) {
    return { segments: null, reason: "missing-carry-side" };
  }

  const first: HermiteSegment = {
    ...model.originToApex,
    startY: 0,
    endY: apexSideYd,
  };
  const second: HermiteSegment = {
    ...model.apexToCarry,
    startY: apexSideYd,
    endY: carrySideYd,
  };
  const [launchSlope, apexSlope, carrySlope] = lateralSlopes(
    first,
    second,
    launchDirectionDeg,
  );
  first.startSlope = launchSlope;
  first.endSlope = apexSlope;
  second.startSlope = apexSlope;
  second.endSlope = carrySlope;

  return { segments: [first, second], reason: null };
}

function buildShotFlight(
  shot: ModeledShotInput,
  samplesPerSegment: number,
): ModeledShotFlight {
  const measured = measuredLandmarks(shot.measurements);
  const { model, reasons } = createVerticalModel(shot.measurements);
  if (model === null) {
    return {
      shotId: shot.shotId,
      rowIndex: shot.rowIndex,
      included: shot.included,
      status: "insufficient-data",
      insufficientReasons: reasons,
      lateralStatus: "insufficient-data",
      lateralReason: null,
      measuredLandmarks: measured,
      modeledPoints: [],
    };
  }

  const lateral = createLateralSegments(model, shot.measurements);
  const firstVertical = sampleSegment(model.originToApex, samplesPerSegment, true);
  const secondVertical = sampleSegment(model.apexToCarry, samplesPerSegment, false);
  const vertical = [...firstVertical, ...secondVertical];
  const lateralFirst = lateral.segments
    ? sampleSegment(lateral.segments[0], samplesPerSegment, true)
    : null;
  const lateralSecond = lateral.segments
    ? sampleSegment(lateral.segments[1], samplesPerSegment, false)
    : null;
  const lateralValues =
    lateralFirst && lateralSecond ? [...lateralFirst, ...lateralSecond] : null;

  return {
    shotId: shot.shotId,
    rowIndex: shot.rowIndex,
    included: shot.included,
    status: "modeled",
    insufficientReasons: [],
    lateralStatus: lateral.segments ? "modeled" : "insufficient-data",
    lateralReason: lateral.reason,
    measuredLandmarks: measured,
    modeledPoints: vertical.map((point, index) => ({
      downrangeYd: point.downrangeYd,
      heightYd: point.value,
      lateralYd: lateralValues?.[index]?.value ?? null,
    })),
  };
}

function emptyBounds(): FlightBounds {
  return {
    minDownrangeYd: null,
    maxDownrangeYd: null,
    minHeightYd: null,
    maxHeightYd: null,
    minLateralYd: null,
    maxLateralYd: null,
  };
}

function calculateBounds(flights: readonly ModeledShotFlight[]): FlightBounds {
  let hasPoints = false;
  let hasLateralValues = false;
  let minDownrangeYd = Infinity;
  let maxDownrangeYd = -Infinity;
  let minHeightYd = Infinity;
  let maxHeightYd = -Infinity;
  let minLateralYd = Infinity;
  let maxLateralYd = -Infinity;

  for (const flight of flights) {
    if (flight.status !== "modeled") continue;
    for (const point of flight.modeledPoints) {
      hasPoints = true;
      minDownrangeYd = Math.min(minDownrangeYd, point.downrangeYd);
      maxDownrangeYd = Math.max(maxDownrangeYd, point.downrangeYd);
      minHeightYd = Math.min(minHeightYd, point.heightYd);
      maxHeightYd = Math.max(maxHeightYd, point.heightYd);
      if (point.lateralYd !== null) {
        hasLateralValues = true;
        minLateralYd = Math.min(minLateralYd, point.lateralYd);
        maxLateralYd = Math.max(maxLateralYd, point.lateralYd);
      }
    }
  }

  if (!hasPoints) return emptyBounds();
  return {
    minDownrangeYd,
    maxDownrangeYd,
    minHeightYd,
    maxHeightYd,
    minLateralYd: hasLateralValues ? minLateralYd : null,
    maxLateralYd: hasLateralValues ? maxLateralYd : null,
  };
}

/**
 * Uses cubic Hermite segments in downrange coordinates. The vertical tangents
 * use launch angle, zero slope at the measured apex, and negative landing-angle
 * slope at carry; lateral geometry is a separate smooth interpolation through
 * the signed measured landmarks and launch direction.
 */
export function buildModeledShotFlight(
  shot: ModeledShotInput,
  options: Pick<ClubFlightModelOptions, "samplesPerSegment"> = {},
): ModeledShotFlight {
  const samplesPerSegment =
    options.samplesPerSegment ?? DEFAULT_SAMPLES_PER_SEGMENT;
  if (!Number.isInteger(samplesPerSegment) || samplesPerSegment < 2) {
    throw new RangeError("samplesPerSegment must be an integer of at least 2.");
  }

  return buildShotFlight(shot, samplesPerSegment);
}

export function buildClubFlightModel(
  shots: readonly ModeledShotInput[],
  options: ClubFlightModelOptions = {},
): ClubFlightModel {
  const samplesPerSegment =
    options.samplesPerSegment ?? DEFAULT_SAMPLES_PER_SEGMENT;
  if (!Number.isInteger(samplesPerSegment) || samplesPerSegment < 2) {
    throw new RangeError("samplesPerSegment must be an integer of at least 2.");
  }

  const flights = shots
    .filter((shot) => !options.includedOnly || shot.included)
    .map((shot) => buildShotFlight(shot, samplesPerSegment));

  return { flights, bounds: calculateBounds(flights) };
}
