import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import { isStagedTrackManBatch, parsePositiveRouteId } from "@/lib/imports/trackmanShotReview";
import { getShotReviewShotData } from "@/lib/imports/golfShotMeasurements";

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; summaryId: string }> },
): Promise<NextResponse> {
  const session = getStaffSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id, summaryId: summaryIdString } = await params;
  const batchId = parsePositiveRouteId(id);
  const summaryId = parsePositiveRouteId(summaryIdString);
  if (batchId === null || summaryId === null) {
    return NextResponse.json({ error: "Invalid ID." }, { status: 400 });
  }

  const batch = await db.importBatch.findUnique({
    where: { id: batchId },
    select: { parserMode: true, demoSessionId: true },
  });
  if (!batch) {
    return NextResponse.json({ error: "Import batch not found." }, { status: 404 });
  }
  if (!isStagedTrackManBatch(batch)) {
    return NextResponse.json(
      { error: "Shot review is only available for unconfirmed TrackMan imports." },
      { status: 409 },
    );
  }

  const summary = await db.importClubSummary.findFirst({
    where: { id: summaryId, importBatchId: batchId },
    select: {
      id: true,
      shotCount: true,
      avgClubSpeed: true,
      avgBallSpeed: true,
      avgSpinRate: true,
      avgMaxHeight: true,
      avgCarry: true,
      avgTotal: true,
      validClubSpeedCount: true,
      validBallSpeedCount: true,
      validSpinRateCount: true,
      validMaxHeightCount: true,
      validCarryCount: true,
      validTotalCount: true,
    },
  });
  if (!summary) {
    return NextResponse.json({ error: "Club summary not found." }, { status: 404 });
  }

  const rows = await db.importRow.findMany({
    where: { importBatchId: batchId, clubSummaryId: summaryId },
    orderBy: { rowIndex: "asc" },
    select: { id: true, rowIndex: true, rawData: true, includedInSummary: true },
  });

  return NextResponse.json({
    summary: {
      ...summary,
      avgClubSpeed: numberValue(summary.avgClubSpeed),
      avgBallSpeed: numberValue(summary.avgBallSpeed),
      avgSpinRate: numberValue(summary.avgSpinRate),
      avgMaxHeight: numberValue(summary.avgMaxHeight),
      avgCarry: numberValue(summary.avgCarry),
      avgTotal: numberValue(summary.avgTotal),
    },
    shots: rows.map((row) => {
      return {
        id: row.id,
        rowIndex: row.rowIndex,
        included: row.includedInSummary !== false,
        ...getShotReviewShotData(row.rawData),
      };
    }),
  });
}
