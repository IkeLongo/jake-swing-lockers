import type { CustomerClub } from "@/lib/queries/customer-sessions";
import { buildClubFlightModel } from "./modeledFlight";

export function buildCustomerShotFlights(
  clubs: readonly Pick<CustomerClub, "id" | "approvedShotSnapshot">[],
) {
  const shots = clubs.flatMap((club) =>
    (club.approvedShotSnapshot?.shots ?? []).map((shot, rowIndex) => ({
      shotId: `${club.id}:${rowIndex}`,
      rowIndex,
      included: true,
      clubSummaryId: club.id,
      measurements: shot.measurements,
    })),
  );
  const { flights } = buildClubFlightModel(shots);
  return {
    includedShotCount: shots.length,
    // The shared renderer centers missing lateral values; do not do that here.
    flights: flights.filter((flight) =>
      flight.status === "modeled" &&
      flight.lateralStatus === "modeled" &&
      flight.modeledPoints.every((point) =>
        Number.isFinite(point.downrangeYd) &&
        Number.isFinite(point.heightYd) &&
        point.lateralYd !== null &&
        Number.isFinite(point.lateralYd),
      ),
    ),
  };
}
