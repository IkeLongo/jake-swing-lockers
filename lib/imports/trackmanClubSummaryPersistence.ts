import type { Prisma } from "@/app/generated/prisma/client";
import {
  aggregateTrackManClubGroups,
  calculateTrackManSummaryMetrics,
  type TrackManSummaryMetrics,
} from "./trackmanAggregation";

export interface TrackManShotRowInput {
  id: number;
  rowIndex: number;
  rawData: Record<string, unknown>;
}

export interface TrackManAssociatedShot {
  rawData: Record<string, unknown>;
  includedInSummary: boolean | null;
}

export function calculateIncludedTrackManSummaryMetrics(
  shots: readonly TrackManAssociatedShot[],
): TrackManSummaryMetrics {
  return calculateTrackManSummaryMetrics(
    shots
      .filter((shot) => shot.includedInSummary !== false)
      .map((shot) => shot.rawData),
  );
}

/**
 * Creates initial TrackMan summaries and associates each source row by the
 * grouping calculated before editable summary names and tags can change.
 */
export async function createTrackManClubSummaries(
  tx: Prisma.TransactionClient,
  batchId: number,
  shots: readonly TrackManShotRowInput[],
): Promise<number> {
  const groups = aggregateTrackManClubGroups(
    shots.map((shot) => shot.rawData),
  );

  for (const group of groups) {
    const summary = await tx.importClubSummary.create({
      data: {
        importBatchId: batchId,
        originalClubName: group.summary.originalClubName,
        clubName: group.summary.clubName,
        tags: group.summary.tags,
        shotCount: group.summary.shotCount,
        avgClubSpeed: group.summary.avgClubSpeed,
        avgBallSpeed: group.summary.avgBallSpeed,
        avgSpinRate: group.summary.avgSpinRate,
        avgMaxHeight: group.summary.avgMaxHeight,
        avgCarry: group.summary.avgCarry,
        avgTotal: group.summary.avgTotal,
        validClubSpeedCount: group.summary.validClubSpeedCount,
        validBallSpeedCount: group.summary.validBallSpeedCount,
        validSpinRateCount: group.summary.validSpinRateCount,
        validMaxHeightCount: group.summary.validMaxHeightCount,
        validCarryCount: group.summary.validCarryCount,
        validTotalCount: group.summary.validTotalCount,
        isManuallyEdited: false,
        includeInReport: true,
      },
      select: { id: true },
    });

    const rowIds = group.rowIndexes.map((index) => shots[index]!.id);
    await tx.importRow.updateMany({
      where: { importBatchId: batchId, id: { in: rowIds } },
      data: { clubSummaryId: summary.id, includedInSummary: true },
    });
  }

  return groups.length;
}

/**
 * Updates only calculated metrics from the included shots associated with one
 * summary. Staff-controlled summary state is not part of this update payload.
 */
export async function recalculateTrackManClubSummary(
  tx: Prisma.TransactionClient,
  batchId: number,
  summaryId: number,
) {
  const shots = await tx.importRow.findMany({
    where: { importBatchId: batchId, clubSummaryId: summaryId },
    orderBy: { rowIndex: "asc" },
    select: { rawData: true, includedInSummary: true },
  });

  const metrics = calculateIncludedTrackManSummaryMetrics(
    shots.map((shot) => ({
      rawData: shot.rawData as Record<string, unknown>,
      includedInSummary: shot.includedInSummary,
    })),
  );

  return tx.importClubSummary.update({
    where: { id: summaryId },
    data: metrics,
  });
}
