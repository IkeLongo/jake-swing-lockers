import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import { getShotReviewShotData } from "@/lib/imports/golfShotMeasurements";
import {
  getFittingVisualizationAccessError,
  serializeFittingVisualizationShots,
} from "@/lib/imports/fittingVisualizationData";
import { parsePositiveRouteId } from "@/lib/imports/trackmanShotReview";

function stringTags(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((tag): tag is string => typeof tag === "string")
    : [];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = getStaffSessionFromRequest(request);
  const authorizationError = getFittingVisualizationAccessError(
    session !== null,
    undefined,
  );
  if (authorizationError) {
    return NextResponse.json(
      { error: authorizationError.error },
      { status: authorizationError.status },
    );
  }

  const { id } = await params;
  const batchId = parsePositiveRouteId(id);
  if (batchId === null) {
    return NextResponse.json({ error: "Invalid ID." }, { status: 400 });
  }

  const batch = await db.importBatch.findUnique({
    where: { id: batchId },
    select: { parserMode: true, demoSessionId: true },
  });
  const accessError = getFittingVisualizationAccessError(true, batch);
  if (accessError) {
    return NextResponse.json(
      { error: accessError.error },
      { status: accessError.status },
    );
  }

  const clubs = await db.importClubSummary.findMany({
    where: { importBatchId: batchId },
    select: { id: true, clubName: true, tags: true },
  });
  const summaryIds = clubs.map((club) => club.id);
  if (summaryIds.length === 0) {
    return NextResponse.json({ shots: [] });
  }

  const rows = await db.importRow.findMany({
    where: {
      importBatchId: batchId,
      clubSummaryId: { in: summaryIds },
    },
    orderBy: { rowIndex: "asc" },
    select: {
      id: true,
      rowIndex: true,
      clubSummaryId: true,
      includedInSummary: true,
      rawData: true,
    },
  });

  const data = serializeFittingVisualizationShots(
    clubs.map((club) => ({
      id: club.id,
      clubName: club.clubName,
      tags: stringTags(club.tags),
    })),
    rows.map((row) => ({
      id: row.id,
      rowIndex: row.rowIndex,
      clubSummaryId: row.clubSummaryId,
      includedInSummary: row.includedInSummary,
      measurementData: getShotReviewShotData(row.rawData).measurementData,
    })),
  );

  return NextResponse.json(data);
}
