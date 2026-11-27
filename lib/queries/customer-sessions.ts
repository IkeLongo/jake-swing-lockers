import { db } from "@/lib/db";
import { groupFinalizedClubs } from "@/lib/comparison/groupFinalizedClubs";
import { sumPrices } from "@/lib/fitting-value";
import type { ApprovedShotSnapshotV1 } from "@/lib/imports/approvedShotSnapshot";
import { z } from "zod";
import { purchaseClubName } from "@/lib/purchase-request-workflow";

export type CustomerShotSnapshot = {
  version: ApprovedShotSnapshotV1["version"];
  shots: Omit<ApprovedShotSnapshotV1["shots"][number], "sourceRowId">[];
};

const nullableMeasurement = z.number().finite().nullable();
const customerShotSnapshotSchema: z.ZodType<CustomerShotSnapshot> = z.object({
  version: z.literal(1),
  shots: z.array(z.object({
    lateralSignConvention: z.literal("unknown").nullable(),
    measurements: z.object({
      carryYd: nullableMeasurement,
      carrySideYd: nullableMeasurement,
      apexDistanceYd: nullableMeasurement,
      apexHeightYd: nullableMeasurement,
      apexSideYd: nullableMeasurement,
      launchAngleDeg: nullableMeasurement,
      launchDirectionDeg: nullableMeasurement,
      landingAngleDeg: nullableMeasurement,
      totalYd: nullableMeasurement,
      totalSideYd: nullableMeasurement,
    }),
  })),
});

// ── Return shapes ─────────────────────────────────────────────────────────────

export interface CustomerSessionSummary {
  id: number;
  demoDate: Date;
  includedClubCount: number;
  includedClubs: CustomerSessionClubSummary[];
  recommendedClubs: CustomerSessionClubSummary[];
  /** Sum of estimatedPrice across eligible clubs. Null if no prices are set. */
  estimatedTotal: number | null;
  status: string;
}

export interface CustomerSessionClubSummary {
  id: number;
  name: string | null;
  label: string;
}

export interface CustomerClub {
  id: number;
  clubType: string | null;
  tags: string[];
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
  avgMaxHeight: number | null;
  launchAngle: number | null;
  dispersion: number | null;
  estimatedPrice: number | null;
  approvedShotSnapshot: CustomerShotSnapshot | null;
}

export interface CustomerDemoClub extends CustomerClub {
  comparisonClub: CustomerClub | null;
}

export interface CustomerPurchaseClub {
  id: number;
  label: string;
  estimatedPrice: number | null;
}

export interface CustomerSessionDetail {
  id: number;
  demoDate: string;
  customerName: string;
  notes: string | null;
  clubs: CustomerDemoClub[];
  resultsClubs: CustomerClub[];
  purchaseClubs: CustomerPurchaseClub[];
  /** Sum of estimatedPrice across eligible clubs. Null if no prices are set. */
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
    orderBy: [
      { demoDate: "desc" },
      { createdAt: "desc" },
      { id: "desc" },
    ],
    select: {
      id: true,
      demoDate: true,
      status: true,
      clubTests: {
        select: {
          id: true,
          clubType: true,
          clubRole: true,
          tags: true,
          includeInReport: true,
          availableForPurchase: true,
          estimatedPrice: true,
        },
      },
    },
  });

  return rows.map((row) => {
    const includedRows = row.clubTests.filter(
      (club) => club.includeInReport ?? club.clubRole === "demo",
    );
    const summarizeClub = (club: (typeof row.clubTests)[number]): CustomerSessionClubSummary => {
      const tags = Array.isArray(club.tags)
        ? club.tags.filter((tag): tag is string => typeof tag === "string")
        : [];
      const tagList = tags.join(", ");
      let name = club.clubType?.trim() ?? "";
      if (tagList) {
        for (const suffix of [` - ${tagList}`, ` · ${tagList}`]) {
          if (name.endsWith(suffix)) {
            name = name.slice(0, -suffix.length);
            break;
          }
        }
      }
      const fallbackClubName = name || "Club";
      const label = tags.length > 0
        ? `${fallbackClubName} · ${tagList}`
        : fallbackClubName;
      return {
        id: club.id,
        name: name || null,
        label,
      };
    };
    const uniqueClubs = (clubs: typeof row.clubTests) =>
      [...new Map(clubs.map((club) => [club.id, summarizeClub(club)])).values()];
    const includedClubs = uniqueClubs(includedRows);
    const recommendedClubs = uniqueClubs(
      row.clubTests.filter((club) => club.availableForPurchase),
    );
    const priceRows = row.clubTests.filter((club) => club.availableForPurchase);

    return {
      id: row.id,
      demoDate: row.demoDate,
      status: row.status,
      includedClubCount: includedClubs.length,
      includedClubs,
      recommendedClubs,
      estimatedTotal: priceRows.some((club) => club.estimatedPrice !== null)
        ? sumPrices(priceRows.map((club) => club.estimatedPrice))
        : null,
    };
  });
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
          includeInReport: true,
          availableForPurchase: true,
          tags: true,
          pairIndex: true,
          currentClubTestId: true,
          approvedShotSnapshot: true,
          metrics: {
            select: {
              clubSpeed: true,
              ballSpeed: true,
              smashFactor: true,
              spinRate: true,
              carryDistance: true,
              totalDistance: true,
              avgMaxHeight: true,
              launchAngle: true,
              dispersion: true,
            },
          },
        },
      },
    },
  });

  if (!row) return null;

  const mappedClubs = new Map<number, CustomerClub>();
  const toCustomerClub = (ct: (typeof row.clubTests)[number]): CustomerClub => {
    const mapped = mappedClubs.get(ct.id);
    if (mapped) return mapped;
    let approvedShotSnapshot: CustomerShotSnapshot | null = null;
    if (ct.approvedShotSnapshot !== null) {
      const parsed = customerShotSnapshotSchema.safeParse(ct.approvedShotSnapshot);
      if (parsed.success) {
        approvedShotSnapshot = parsed.data;
      } else {
        console.warn("[getCustomerSession] Invalid approved shot snapshot for club", ct.id);
      }
    }

    const club: CustomerClub = {
      id: ct.id,
      clubType: ct.clubType,
      tags: Array.isArray(ct.tags)
        ? ct.tags.filter((tag): tag is string => typeof tag === "string")
        : [],
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
      avgMaxHeight: toNum(ct.metrics?.avgMaxHeight),
      launchAngle: toNum(ct.metrics?.launchAngle),
      dispersion: toNum(ct.metrics?.dispersion),
      approvedShotSnapshot,
    };
    mappedClubs.set(ct.id, club);
    return club;
  };
  const currentByTestId = new Map(
    groupFinalizedClubs(row.clubTests).flatMap((group) =>
      group.current
        ? group.tests.map((test) => [test.id, group.current!] as const)
        : [],
    ),
  );
  const demoClubs = row.clubTests.filter((club) => club.clubRole === "demo");
  const resultsClubs = row.clubTests
    .filter((club) => club.includeInReport ?? (club.clubRole === "demo"))
    .map(toCustomerClub);
  const clubs: CustomerDemoClub[] = demoClubs.map((club) => {
    const current = currentByTestId.get(club.id);
    return {
      ...toCustomerClub(club),
      comparisonClub: current ? toCustomerClub(current) : null,
    };
  });
  const purchaseClubs = row.clubTests.filter((club) => club.availableForPurchase).map((club) => ({
    id: club.id,
    label: [purchaseClubName(club), club.brand, club.model].filter(Boolean).join(" — "),
    estimatedPrice: toNum(club.estimatedPrice),
  }));

  return {
    id: row.id,
    demoDate: row.demoDate.toISOString(),
    customerName:
      [row.client.firstName, row.client.lastName].filter(Boolean).join(" ") || "Golfer",
    notes: row.notes,
    clubs,
    resultsClubs,
    purchaseClubs,
    estimatedTotal: purchaseClubs.some((club) => club.estimatedPrice !== null)
      ? sumPrices(purchaseClubs.map((club) => club.estimatedPrice))
      : null,
  };
}
