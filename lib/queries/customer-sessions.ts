import { db } from "@/lib/db";
import { groupFinalizedClubs } from "@/lib/comparison/groupFinalizedClubs";
import { sumPrices } from "@/lib/fitting-value";

// ── Return shapes ─────────────────────────────────────────────────────────────

export interface CustomerSessionSummary {
  id: number;
  demoDate: Date;
  clubsTestedCount: number;
  /** Sum of estimatedPrice across all club tests. Null if no prices are set. */
  estimatedTotal: number | null;
  status: string;
}

export interface CustomerClub {
  id: number;
  clubType: string | null;
  brand: string | null;
  model: string | null;
  shaft: string | null;
  loft: string | null;
  clubSpeed: number | null;
  ballSpeed: number | null;
  smashFactor: number | null;
  spinRate: number | null;
  carryDistance: number | null;
  totalDistance: number | null;
  launchAngle: number | null;
  dispersion: number | null;
  estimatedPrice: number | null;
}

export interface CustomerDemoClub extends CustomerClub {
  comparisonClub: CustomerClub | null;
}

export interface CustomerSessionDetail {
  id: number;
  demoDate: string;
  customerName: string;
  notes: string | null;
  clubs: CustomerDemoClub[];
  /** Sum of estimatedPrice across demo clubs. Null if no prices are set. */
  estimatedTotal: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toNum(v: { valueOf(): string } | null | undefined): number | null {
  return v != null ? Number(v) : null;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Returns all finalized demo sessions for the given GolfClient.
 * Ownership is enforced via the clientId WHERE clause.
 * Only `status = "finalized"` sessions are returned.
 */
export async function getCustomerSessions(
  golfClientId: number
): Promise<CustomerSessionSummary[]> {
  const rows = await db.demoSession.findMany({
    where: {
      clientId: golfClientId,
      status: "finalized",
    },
    orderBy: { demoDate: "desc" },
    select: {
      id: true,
      demoDate: true,
      status: true,
      clubTests: {
        where: { clubRole: "demo" },
        select: { estimatedPrice: true },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    demoDate: row.demoDate,
    status: row.status,
    clubsTestedCount: row.clubTests.length,
    estimatedTotal: row.clubTests.some((c) => c.estimatedPrice !== null)
      ? sumPrices(row.clubTests.map((c) => c.estimatedPrice))
      : null,
  }));
}

/**
 * Returns a single finalized demo session for the given GolfClient.
 *
 * Returns null if:
 * - the session does not exist
 * - the session belongs to a different client (ownership check)
 * - the session is not finalized
 *
 * Callers should treat null as a 404 — do NOT return 403.
 */
export async function getCustomerSession(
  golfClientId: number,
  sessionId: number
): Promise<CustomerSessionDetail | null> {
  const row = await db.demoSession.findFirst({
    where: {
      id: sessionId,
      clientId: golfClientId, // ← ownership check
      status: "finalized",    // ← finalized-only
    },
    select: {
      id: true,
      demoDate: true,
      notes: true,
      client: { select: { firstName: true, lastName: true } },
      clubTests: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          clubType: true,
          brand: true,
          model: true,
          shaft: true,
          loft: true,
          estimatedPrice: true,
          clubRole: true,
          pairIndex: true,
          currentClubTestId: true,
          metrics: {
            select: {
              clubSpeed: true,
              ballSpeed: true,
              smashFactor: true,
              spinRate: true,
              carryDistance: true,
              totalDistance: true,
              launchAngle: true,
              dispersion: true,
            },
          },
        },
      },
    },
  });

  if (!row) return null;

  const toCustomerClub = (ct: (typeof row.clubTests)[number]): CustomerClub => ({
    id: ct.id,
    clubType: ct.clubType,
    brand: ct.brand,
    model: ct.model,
    shaft: ct.shaft,
    loft: ct.loft,
    estimatedPrice: toNum(ct.estimatedPrice),
    clubSpeed: toNum(ct.metrics?.clubSpeed),
    ballSpeed: toNum(ct.metrics?.ballSpeed),
    smashFactor: toNum(ct.metrics?.smashFactor),
    spinRate: ct.metrics?.spinRate ?? null,
    carryDistance: toNum(ct.metrics?.carryDistance),
    totalDistance: toNum(ct.metrics?.totalDistance),
    launchAngle: toNum(ct.metrics?.launchAngle),
    dispersion: toNum(ct.metrics?.dispersion),
  });
  const currentByTestId = new Map(
    groupFinalizedClubs(row.clubTests).flatMap((group) =>
      group.current
        ? group.tests.map((test) => [test.id, group.current!] as const)
        : [],
    ),
  );
  const demoClubs = row.clubTests.filter((club) => club.clubRole === "demo");
  const clubs: CustomerDemoClub[] = demoClubs.map((club) => {
    const current = currentByTestId.get(club.id);
    return {
      ...toCustomerClub(club),
      comparisonClub: current ? toCustomerClub(current) : null,
    };
  });

  return {
    id: row.id,
    demoDate: row.demoDate.toISOString(),
    customerName:
      [row.client.firstName, row.client.lastName].filter(Boolean).join(" ") || "Golfer",
    notes: row.notes,
    clubs,
    estimatedTotal: demoClubs.some((club) => club.estimatedPrice !== null)
      ? sumPrices(demoClubs.map((club) => club.estimatedPrice))
      : null,
  };
}
