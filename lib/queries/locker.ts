import { db } from "@/lib/db";

/**
 * Fetches the public-safe fields for a swing locker page by token.
 * Internal IDs, GHL IDs, and admin fields are intentionally excluded.
 */
export async function getLockerByToken(token: string) {
  return db.demoSession.findUnique({
    where: { lockerToken: token },
    select: {
      demoDate: true,
      salesRep: true,
      clientGoal: true,
      notes: true,
      client: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
      clubTests: {
        orderBy: { sortOrder: "asc" },
        select: {
          clubType: true,
          brand: true,
          model: true,
          shaft: true,
          loft: true,
          estimatedPrice: true,
          notes: true,
          isRecommended: true,
          clubRole: true,
          pairIndex: true,
          metrics: {
            select: {
              clubSpeed: true,
              ballSpeed: true,
              smashFactor: true,
              carryDistance: true,
              totalDistance: true,
              launchAngle: true,
              spinRate: true,
              dispersion: true,
            },
          },
        },
      },
    },
  });
}

export type LockerData = NonNullable<Awaited<ReturnType<typeof getLockerByToken>>>;
