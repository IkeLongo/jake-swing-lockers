export interface TrackManBatchReviewState {
  parserMode: string;
  demoSessionId: number | null;
}

export interface TrackManShotAssociationState {
  importBatchId: number;
  clubSummaryId: number | null;
}

export function isStagedTrackManBatch(
  batch: TrackManBatchReviewState,
): boolean {
  return batch.parserMode === "trackman-result" && batch.demoSessionId === null;
}

export function isTrackManShotAssociatedWithSummary(
  batchId: number,
  summaryId: number,
  row: TrackManShotAssociationState,
): boolean {
  return row.importBatchId === batchId && row.clubSummaryId === summaryId;
}

export function parsePositiveRouteId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}
