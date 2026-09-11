import { db } from "@/lib/db";

const LOCKER_SELECT = {
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
    orderBy: { sortOrder: "asc" as const },
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
} as const;

/**
 * Fetches the public-safe fields for a swing locker page by token.
 * Internal IDs, GHL IDs, and admin fields are intentionally excluded.
 */
export async function getLockerByToken(token: string) {
  return db.demoSession.findUnique({
    where: { lockerToken: token },
    select: LOCKER_SELECT,
  });
}

/**
 * Fetches locker data for a staff preview by session ID.
 * Only returns data if the session is finalized.
 */
export async function getLockerBySessionId(sessionId: number) {
  return db.demoSession.findFirst({
    where: { id: sessionId, status: "finalized" },
    select: LOCKER_SELECT,
  });
}

export type LockerData = NonNullable<Awaited<ReturnType<typeof getLockerByToken>>>;
