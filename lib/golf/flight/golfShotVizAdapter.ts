import type { ShotInput } from "golf-shot-viz";
import type { ModeledShotFlight } from "./types";
import { yardsToFeet, yardsToMeters } from "./units";

export interface GolfShotVizFlight extends ShotInput {
  id: string;
  rowIndex: number;
  clubSummaryId?: number;
  apexHeightFt: number | null;
  lateralDataAvailable: boolean;
}

export interface GolfShotVizClubOptions {
  colorsBySummaryId?: ReadonlyMap<number, string>;
  namesBySummaryId?: ReadonlyMap<number, string>;
}

export function toGolfShotVizFlights(
  flights: readonly ModeledShotFlight[],
  clubOptions: GolfShotVizClubOptions = {},
): GolfShotVizFlight[] {
  return flights
    .filter((flight) => flight.included && flight.status === "modeled")
    .map((flight) => {
      const apexHeightYd = flight.measuredLandmarks.apex?.heightYd ?? null;
      const clubName =
        flight.clubSummaryId === undefined
          ? null
          : clubOptions.namesBySummaryId?.get(flight.clubSummaryId);
      const lateralDataAvailable =
        flight.lateralStatus === "modeled" &&
        flight.modeledPoints.every((point) => point.lateralYd !== null);
      return {
        id: flight.shotId,
        rowIndex: flight.rowIndex,
        ...(flight.clubSummaryId === undefined
          ? {}
          : { clubSummaryId: flight.clubSummaryId }),
        lateralDataAvailable,
        ...(flight.clubSummaryId === undefined
          ? {}
          : {
              color: clubOptions.colorsBySummaryId?.get(
                flight.clubSummaryId,
              ),
            }),
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
          club: clubName ?? `Shot ${flight.rowIndex + 1}`,
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
