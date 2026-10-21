import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import { recalculateTrackManClubSummary } from "@/lib/imports/trackmanClubSummaryPersistence";
import {
  isStagedTrackManBatch,
  isTrackManShotAssociatedWithSummary,
  parsePositiveRouteId,
} from "@/lib/imports/trackmanShotReview";

function numberValue(value: { toNumber(): number } | null): number | null {
  return value?.toNumber() ?? null;
}

export async function PATCH(
  req: NextRequest,
  {
    params,
  }: { params: Promise<{ id: string; summaryId: string; rowId: string }> },
): Promise<NextResponse> {
  const session = getStaffSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id, summaryId: summaryIdString, rowId: rowIdString } = await params;
  const batchId = parsePositiveRouteId(id);
  const summaryId = parsePositiveRouteId(summaryIdString);
  const rowId = parsePositiveRouteId(rowIdString);
  if (batchId === null || summaryId === null || rowId === null) {
    return NextResponse.json({ error: "Invalid ID." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    typeof (body as Record<string, unknown>).included !== "boolean"
  ) {
    return NextResponse.json(
      { error: "included must be a boolean." },
      { status: 422 },
    );
  }
  const included = (body as { included: boolean }).included;

  return db.$transaction(async (tx) => {
    const batch = await tx.importBatch.findUnique({
      where: { id: batchId },
      select: { parserMode: true, demoSessionId: true },
    });
    if (!batch) {
      return NextResponse.json(
        { error: "Import batch not found." },
        { status: 404 },
      );
    }
    if (!isStagedTrackManBatch(batch)) {
      return NextResponse.json(
        { error: "Shot review is only available for unconfirmed TrackMan imports." },
        { status: 409 },
      );
    }

    const summary = await tx.importClubSummary.findFirst({
      where: { id: summaryId, importBatchId: batchId },
      select: { id: true },
    });
    if (!summary) {
      return NextResponse.json(
        { error: "Club summary not found." },
        { status: 404 },
      );
    }

    const row = await tx.importRow.findUnique({
      where: { id: rowId },
      select: { id: true, importBatchId: true, clubSummaryId: true },
    });
    if (
      !row ||
      !isTrackManShotAssociatedWithSummary(batchId, summaryId, row)
    ) {
      return NextResponse.json(
        { error: "Shot not found for this club summary." },
        { status: 404 },
      );
    }

    const update = await tx.importRow.updateMany({
      where: {
        id: rowId,
        importBatchId: batchId,
        clubSummaryId: summaryId,
      },
      data: { includedInSummary: included },
    });
    if (update.count !== 1) {
      return NextResponse.json(
        { error: "Shot association changed; reload and try again." },
        { status: 409 },
      );
    }

    const updatedSummary = await recalculateTrackManClubSummary(
      tx,
      batchId,
      summaryId,
    );

    return NextResponse.json({
      success: true,
      shot: { id: rowId, included },
      summary: {
        id: updatedSummary.id,
        shotCount: updatedSummary.shotCount,
        avgClubSpeed: numberValue(updatedSummary.avgClubSpeed),
        avgBallSpeed: numberValue(updatedSummary.avgBallSpeed),
        avgSpinRate: numberValue(updatedSummary.avgSpinRate),
        avgMaxHeight: numberValue(updatedSummary.avgMaxHeight),
        avgCarry: numberValue(updatedSummary.avgCarry),
        avgTotal: numberValue(updatedSummary.avgTotal),
        validClubSpeedCount: updatedSummary.validClubSpeedCount,
        validBallSpeedCount: updatedSummary.validBallSpeedCount,
        validSpinRateCount: updatedSummary.validSpinRateCount,
        validMaxHeightCount: updatedSummary.validMaxHeightCount,
        validCarryCount: updatedSummary.validCarryCount,
        validTotalCount: updatedSummary.validTotalCount,
      },
    });
  });
}
