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

type TrackManClubSummaryCreateData = Pick<
  Prisma.ImportClubSummaryUncheckedCreateInput,
  | "importBatchId"
  | "originalClubName"
  | "clubName"
  | "tags"
  | "shotCount"
  | "avgClubSpeed"
  | "avgBallSpeed"
  | "avgSpinRate"
  | "avgMaxHeight"
  | "avgCarry"
  | "avgTotal"
  | "validClubSpeedCount"
  | "validBallSpeedCount"
  | "validSpinRateCount"
  | "validMaxHeightCount"
  | "validCarryCount"
  | "validTotalCount"
  | "isManuallyEdited"
  | "includeInReport"
>;

export interface TrackManClubSummaryPersistenceOperations {
  createSummary(
    data: TrackManClubSummaryCreateData,
  ): Promise<{ id: number } | null>;
  associateRows(
    batchId: number,
    rowIds: readonly number[],
    summaryId: number,
  ): Promise<number>;
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
  return persistTrackManClubSummaries(
    {
      createSummary: (data) =>
        tx.importClubSummary.create({ data, select: { id: true } }),
      async associateRows(associatedBatchId, rowIds, summaryId) {
        const result = await tx.importRow.updateMany({
          where: { importBatchId: associatedBatchId, id: { in: [...rowIds] } },
          data: { clubSummaryId: summaryId, includedInSummary: true },
        });
        return result.count;
      },
    },
    batchId,
    shots,
  );
}

export async function persistTrackManClubSummaries(
  operations: TrackManClubSummaryPersistenceOperations,
  batchId: number,
  shots: readonly TrackManShotRowInput[],
): Promise<number> {
  const groups = aggregateTrackManClubGroups(
    shots.map((shot) => shot.rawData),
  );

  for (const [groupIndex, group] of groups.entries()) {
    const summary = await operations.createSummary({
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
    });

    if (
      summary === null ||
      !Number.isSafeInteger(summary.id) ||
      summary.id <= 0
    ) {
      throw new Error(
        `TrackMan club summary creation returned no valid record for group ${groupIndex + 1} of ${groups.length}.`,
      );
    }

    const rowIds = group.rowIndexes.map((index) => shots[index]!.id);
    const associatedCount = await operations.associateRows(
      batchId,
      rowIds,
      summary.id,
    );
    if (associatedCount !== rowIds.length) {
      throw new Error(
        `TrackMan shot association failed for summary group ${groupIndex + 1} of ${groups.length}: expected ${rowIds.length} rows, associated ${associatedCount}.`,
      );
    }
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
