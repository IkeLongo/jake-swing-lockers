import { readGolfShotMeasurements } from "./golfShotMeasurements";
import { isTrackManShotAssociatedWithSummary } from "./trackmanShotReview";

export type ApprovedShotSnapshotV1 = {
  version: 1;
  sourceBatchId: number;
  sourceSummaryId: number;
  shots: Array<{
    sourceRowId: number;
    lateralSignConvention: "unknown" | null;
    measurements: {
      carryYd: number | null;
      carrySideYd: number | null;
      apexDistanceYd: number | null;
      apexHeightYd: number | null;
      apexSideYd: number | null;
      launchAngleDeg: number | null;
      launchDirectionDeg: number | null;
      landingAngleDeg: number | null;
      totalYd: number | null;
      totalSideYd: number | null;
    };
  }>;
};

interface SnapshotSource {
  batch: { id: number; parserMode: string };
  summary: { id: number; importBatchId: number };
  // The caller must supply all rows from the batch, including unassociated rows.
  rows: readonly {
    id: number;
    importBatchId: number;
    clubSummaryId: number | null;
    rowIndex: number;
    includedInSummary: boolean | null;
    rawData: unknown;
  }[];
}

export function buildApprovedShotSnapshot(
  source: SnapshotSource | null,
): ApprovedShotSnapshotV1 | null {
  if (source === null || source.batch.parserMode !== "trackman-result") {
    return null;
  }

  const { batch, summary, rows } = source;
  if (summary.importBatchId !== batch.id) {
    throw new Error("The source summary does not belong to the source batch.");
  }
  if (rows.some((row) => row.importBatchId === batch.id && row.clubSummaryId === null)) {
    return null;
  }

  const shots = rows
    .filter(
      (row) =>
        isTrackManShotAssociatedWithSummary(batch.id, summary.id, row) &&
        row.includedInSummary !== false,
    )
    .sort((a, b) => a.rowIndex - b.rowIndex || a.id - b.id)
    .map((row) => {
      const shot = readGolfShotMeasurements(row.rawData);
      const {
        carryYd,
        carrySideYd,
        apexDistanceYd,
        apexHeightYd,
        apexSideYd,
        launchAngleDeg,
        launchDirectionDeg,
        landingAngleDeg,
        totalYd,
        totalSideYd,
      } = shot.measurements;

      return {
        sourceRowId: row.id,
        lateralSignConvention:
          shot.lateralSignConvention === "unknown" ? "unknown" as const : null,
        measurements: {
          carryYd,
          carrySideYd,
          apexDistanceYd,
          apexHeightYd,
          apexSideYd,
          launchAngleDeg,
          launchDirectionDeg,
          landingAngleDeg,
          totalYd,
          totalSideYd,
        },
      };
    });

  return {
    version: 1,
    sourceBatchId: batch.id,
    sourceSummaryId: summary.id,
    shots,
  };
}
