import type { NormalizedGolfShotMeasurements } from "@/lib/imports/golfShotMeasurements";

export type FlightMeasurementInput = Pick<
  NormalizedGolfShotMeasurements,
  | "launchAngleDeg"
  | "launchDirectionDeg"
  | "apexDistanceYd"
  | "apexHeightYd"
  | "apexSideYd"
  | "carryYd"
  | "carrySideYd"
  | "landingAngleDeg"
  | "totalYd"
  | "totalSideYd"
>;

export interface ModeledShotInput {
  shotId: string;
  rowIndex: number;
  included: boolean;
  measurements: FlightMeasurementInput;
}

export interface FlightPoint {
  downrangeYd: number;
  heightYd: number;
  lateralYd: number | null;
}

export interface MeasuredFlightLandmarks {
  origin: {
    downrangeYd: 0;
    heightYd: 0;
    lateralYd: 0;
    provenance: "coordinate-origin";
  };
  apex: {
    downrangeYd: number | null;
    heightYd: number | null;
    lateralYd: number | null;
    provenance: "trackman-measured";
  } | null;
  carry: {
    downrangeYd: number | null;
    lateralYd: number | null;
    provenance: "trackman-measured";
  } | null;
  total: {
    downrangeYd: number | null;
    lateralYd: number | null;
    provenance: "trackman-measured";
  } | null;
}

export type InsufficientFlightReason =
  | "missing-carry"
  | "missing-apex"
  | "missing-launch-angle"
  | "missing-landing-angle"
  | "invalid-vertical-constraints";

export interface ModeledShotFlight {
  shotId: string;
  rowIndex: number;
  included: boolean;
  status: "modeled" | "insufficient-data";
  insufficientReasons: InsufficientFlightReason[];
  lateralStatus: "modeled" | "insufficient-data";
  lateralReason:
    | "missing-launch-direction"
    | "invalid-launch-direction"
    | "missing-apex-side"
    | "missing-carry-side"
    | null;
  measuredLandmarks: MeasuredFlightLandmarks;
  modeledPoints: FlightPoint[];
}

export interface FlightBounds {
  minDownrangeYd: number | null;
  maxDownrangeYd: number | null;
  minHeightYd: number | null;
  maxHeightYd: number | null;
  minLateralYd: number | null;
  maxLateralYd: number | null;
}

export interface ClubFlightModel {
  flights: ModeledShotFlight[];
  bounds: FlightBounds;
}

export interface ClubFlightModelOptions {
  includedOnly?: boolean;
  samplesPerSegment?: number;
}
