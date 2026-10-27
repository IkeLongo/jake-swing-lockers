import type { ShotInput } from "golf-shot-viz";
import type { ModeledShotFlight } from "./types";
import { yardsToFeet, yardsToMeters } from "./units";

export interface GolfShotVizFlight extends ShotInput {
  id: string;
  rowIndex: number;
  apexHeightFt: number | null;
  lateralDataAvailable: boolean;
}

export function toGolfShotVizFlights(
  flights: readonly ModeledShotFlight[],
): GolfShotVizFlight[] {
  return flights
    .filter((flight) => flight.included && flight.status === "modeled")
    .map((flight) => {
      const apexHeightYd = flight.measuredLandmarks.apex?.heightYd ?? null;
      const lateralDataAvailable =
        flight.lateralStatus === "modeled" &&
        flight.modeledPoints.every((point) => point.lateralYd !== null);
      return {
        id: flight.shotId,
        rowIndex: flight.rowIndex,
        lateralDataAvailable,
        apexHeightFt: yardsToFeet(apexHeightYd),
        points: flight.modeledPoints.map(
          (point) =>
            [
              yardsToMeters(point.downrangeYd),
              yardsToMeters(point.heightYd),
              yardsToMeters(point.lateralYd ?? 0),
            ] as [number, number, number],
        ),
        meta: {
          club: `Shot ${flight.rowIndex + 1}`,
        },
      };
    });
}

export function getVisibleSelectedFlightId(
  flights: readonly Pick<GolfShotVizFlight, "id">[],
  selectedFlightId: string | null,
): string | null {
  return flights.some((flight) => flight.id === selectedFlightId)
    ? selectedFlightId
    : null;
}
