import type { ShotReviewMeasurements } from "./golfShotMeasurements";
import { isStagedTrackManBatch } from "./trackmanShotReview";

export interface FittingVisualizationClub {
  id: number;
  clubName: string;
  tags: string[];
}

export interface FittingVisualizationShot {
  shotId: string;
  rowIndex: number;
  summaryId: number;
  clubName: string;
  tags: string[];
  included: boolean;
  measurementData: ShotReviewMeasurements;
}

export interface FittingVisualizationData {
  shots: FittingVisualizationShot[];
}

export interface FittingVisualizationBatchState {
  parserMode: string;
  demoSessionId: number | null;
}

export interface FittingVisualizationAccessError {
  status: 401 | 404 | 409;
  error: string;
}

export function getFittingVisualizationAccessError(
  authorized: boolean,
  batch: FittingVisualizationBatchState | null | undefined,
): FittingVisualizationAccessError | null {
  if (!authorized) return { status: 401, error: "Unauthorized." };
  if (batch === undefined) return null;
  if (batch === null) return { status: 404, error: "Import batch not found." };
  if (!isStagedTrackManBatch(batch)) {
    return {
      status: 409,
      error:
        "Shot review is only available for unconfirmed TrackMan imports.",
    };
  }
  return null;
}

export function serializeFittingVisualizationShots(
  clubs: readonly FittingVisualizationClub[],
  rows: readonly {
    id: number;
    rowIndex: number;
    clubSummaryId: number | null;
    includedInSummary: boolean | null;
    measurementData: ShotReviewMeasurements;
  }[],
): FittingVisualizationData {
  const clubsById = new Map(clubs.map((club) => [club.id, club]));
  const shots: FittingVisualizationShot[] = [];

  for (const row of rows) {
    if (row.clubSummaryId === null) continue;
    const club = clubsById.get(row.clubSummaryId);
    if (!club) continue;
    shots.push({
      shotId: String(row.id),
      rowIndex: row.rowIndex,
      summaryId: club.id,
      clubName: club.clubName.trim() || "Unknown Club",
      tags: club.tags,
      included: row.includedInSummary !== false,
      measurementData: row.measurementData,
    });
  }

  return { shots };
}
