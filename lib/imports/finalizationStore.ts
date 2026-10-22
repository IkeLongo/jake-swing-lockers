import type { Prisma, ImportClubSummary } from "@/app/generated/prisma/client";
import type { FinalizeStore } from "./finalizationPlan";

/** Prisma-backed FinalizeStore. Must be created from a transaction client. */
export function createPrismaFinalizeStore(
  tx: Prisma.TransactionClient,
): FinalizeStore<ImportClubSummary> {
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
      const created = await tx.demoClubTest.create({
        data: {
          demoSessionId: sessionId,
          clubType: row.clubType,
          estimatedPrice: row.summary.estimatedPrice ?? null,
          sortOrder: row.sortOrder,
          clubRole: row.clubRole,
          pairIndex: row.pairIndex,
          currentClubTestId,
          isRecommended: false,
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
