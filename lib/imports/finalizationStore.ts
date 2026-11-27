import type { Prisma, ImportClubSummary } from "@/app/generated/prisma/client";
import { buildApprovedShotSnapshot } from "./approvedShotSnapshot";
import type { FinalizeStore, PlannableSummary, PlannedClubRow } from "./finalizationPlan";

export type PurchaseEligibleSummary = PlannableSummary & {
  availableForPurchase: boolean;
};

export function hasUnfinalizedPurchaseClub<S extends PurchaseEligibleSummary>(
  summaries: readonly S[],
  rows: readonly PlannedClubRow<S>[],
): boolean {
  const finalizedIds = new Set(rows.map((row) => row.summary.id));
  return summaries.some(
    (summary) => summary.availableForPurchase &&
      (!summary.includeInReport || !finalizedIds.has(summary.id)),
  );
}

/** Prisma-backed FinalizeStore. Must be created from a transaction client. */
export function createPrismaFinalizeStore(
  tx: Prisma.TransactionClient,
): FinalizeStore<ImportClubSummary> {
  async function readSource(batchId: number) {
    const batch = await tx.importBatch.findUniqueOrThrow({
      where: { id: batchId },
      select: { id: true, parserMode: true },
    });
    const rows = batch.parserMode === "trackman-result"
      ? await tx.importRow.findMany({
          where: { importBatchId: batchId },
          select: {
            id: true,
            importBatchId: true,
            clubSummaryId: true,
            rowIndex: true,
            includedInSummary: true,
            rawData: true,
          },
        })
      : [];
    return { batch, rows };
  }

  const sources = new Map<number, ReturnType<typeof readSource>>();

  function loadSource(batchId: number) {
    let source = sources.get(batchId);
    if (!source) {
      source = readSource(batchId);
      sources.set(batchId, source);
    }
    return source;
  }

  return {
    listClubs(sessionId) {
      return tx.demoClubTest.findMany({
        where: { demoSessionId: sessionId },
        select: { id: true, currentClubTestId: true },
      });
    },

    async deleteMetrics(clubIds) {
      await tx.clubTestMetrics.deleteMany({
        where: { clubTestId: { in: clubIds } },
      });
    },

    async deleteClubs(clubIds) {
      await tx.demoClubTest.deleteMany({ where: { id: { in: clubIds } } });
    },

    async createClub(sessionId, row, currentClubTestId) {
      const source = await loadSource(row.summary.importBatchId);
      const approvedShotSnapshot = buildApprovedShotSnapshot({
        ...source,
        summary: row.summary,
      });
      const created = await tx.demoClubTest.create({
        data: {
          demoSessionId: sessionId,
          clubType: row.clubType,
          tags: Array.isArray(row.summary.tags)
            ? row.summary.tags.filter((tag): tag is string => typeof tag === "string")
            : [],
          availableForPurchase: row.summary.includeInReport && row.summary.availableForPurchase,
          estimatedPrice: row.summary.estimatedPrice ?? null,
          sortOrder: row.sortOrder,
          clubRole: row.clubRole,
          pairIndex: row.pairIndex,
          currentClubTestId,
          isRecommended: false,
          ...(approvedShotSnapshot === null ? {} : { approvedShotSnapshot }),
        },
        select: { id: true },
      });
      return created.id;
    },

    async createMetrics(clubId, s) {
      await tx.clubTestMetrics.create({
        data: {
          clubTestId: clubId,
          clubSpeed: s.avgClubSpeed,
          ballSpeed: s.avgBallSpeed,
          spinRate:
            s.avgSpinRate !== null ? Math.round(s.avgSpinRate.toNumber()) : null,
          carryDistance: s.avgCarry,
          totalDistance: s.avgTotal,
        },
      });
    },
  };
}
