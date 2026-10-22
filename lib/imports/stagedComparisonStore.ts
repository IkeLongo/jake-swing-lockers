import type { Prisma } from "@/app/generated/prisma/client";
import type { ComparisonStore } from "./stagedComparison";

/**
 * Prisma-backed ComparisonStore. Must be created from a transaction client.
 * Loading the batch takes row locks (SELECT ... FOR UPDATE) so concurrent
 * comparison edits in the same batch serialize and cannot create chains.
 */
export function createPrismaComparisonStore(
  tx: Prisma.TransactionClient,
): ComparisonStore {
  return {
    async loadBatchSummaries(batchId) {
      await tx.$queryRaw`SELECT id FROM ImportClubSummary WHERE importBatchId = ${batchId} FOR UPDATE`;
      return tx.importClubSummary.findMany({
        where: { importBatchId: batchId },
        select: { id: true, currentSummaryId: true },
      });
    },

    async setCurrentSummaryId(summaryIds, currentSummaryId) {
      await tx.importClubSummary.updateMany({
        where: { id: { in: summaryIds } },
        data: { currentSummaryId },
      });
    },

    async markSessionNeedsRefinalization(batchId) {
      const batch = await tx.importBatch.findUnique({
        where: { id: batchId },
        select: { demoSessionId: true },
      });
      if (!batch?.demoSessionId) return;
      await tx.demoSession.updateMany({
        where: {
          id: batch.demoSessionId,
          status: "finalized",
          needsRefinalization: false,
        },
        data: { needsRefinalization: true },
      });
    },
  };
}
