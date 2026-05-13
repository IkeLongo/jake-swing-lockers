import { db } from "@/lib/db";

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
  clubSpeed: number | null;
  ballSpeed: number | null;
  spinRate: number | null;
  carryDistance: number | null;
  totalDistance: number | null;
  estimatedPrice: number | null;
}

export interface CustomerSessionDetail {
  id: number;
  demoDate: Date;
  notes: string | null;
  clubs: CustomerClub[];
  /** Sum of estimatedPrice across clubs. Null if no prices are set. */
  estimatedTotal: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sumPrices(
  prices: ({ valueOf(): string } | null | undefined)[]
): number | null {
  let total = 0;
  let hasAny = false;
  for (const p of prices) {
    if (p != null) {
      total += Number(p);
      hasAny = true;
    }
  }
  return hasAny ? total : null;
}

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
        select: { estimatedPrice: true },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    demoDate: row.demoDate,
    status: row.status,
    clubsTestedCount: row.clubTests.length,
    estimatedTotal: sumPrices(row.clubTests.map((c) => c.estimatedPrice)),
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
      clubTests: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          clubType: true,
          brand: true,
          model: true,
          estimatedPrice: true,
          metrics: {
            select: {
              clubSpeed: true,
              ballSpeed: true,
              spinRate: true,
              carryDistance: true,
              totalDistance: true,
            },
          },
        },
      },
    },
  });

  if (!row) return null;

  const clubs: CustomerClub[] = row.clubTests.map((ct) => ({
    id: ct.id,
    clubType: ct.clubType,
    brand: ct.brand,
    model: ct.model,
    estimatedPrice: toNum(ct.estimatedPrice),
    clubSpeed: toNum(ct.metrics?.clubSpeed),
    ballSpeed: toNum(ct.metrics?.ballSpeed),
    spinRate: ct.metrics?.spinRate ?? null,
    carryDistance: toNum(ct.metrics?.carryDistance),
    totalDistance: toNum(ct.metrics?.totalDistance),
  }));

  return {
    id: row.id,
    demoDate: row.demoDate,
    notes: row.notes,
    clubs,
    estimatedTotal: sumPrices(row.clubTests.map((c) => c.estimatedPrice)),
  };
}
