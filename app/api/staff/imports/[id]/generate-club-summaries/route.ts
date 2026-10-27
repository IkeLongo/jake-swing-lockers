import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import { aggregateTrackManClubSummaries } from "@/lib/imports/trackmanAggregation";
import { createTrackManClubSummaries } from "@/lib/imports/trackmanClubSummaryPersistence";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const session = getStaffSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // ── Resolve batch ID ────────────────────────────────────────────────────────
  const { id } = await params;
  const batchId = parseInt(id, 10);
  if (isNaN(batchId)) {
    return NextResponse.json({ error: "Invalid batch ID." }, { status: 400 });
  }

  // ── Verify batch exists ─────────────────────────────────────────────────────
  const batch = await db.importBatch.findUnique({
    where: { id: batchId },
    select: { id: true, status: true, parserMode: true },
  });
  if (!batch) {
    return NextResponse.json(
      { error: "Import batch not found." },
      { status: 404 },
    );
  }

  // ── Load all ImportRows ─────────────────────────────────────────────────────
  const importRows = await db.importRow.findMany({
    where: { importBatchId: batchId },
    orderBy: { rowIndex: "asc" },
    select: { id: true, rowIndex: true, rawData: true },
  });

  if (importRows.length === 0) {
    return NextResponse.json(
      { error: "No rows found for this batch." },
      { status: 422 },
    );
  }

  const rawRows = importRows.map((r) => r.rawData as Record<string, unknown>);

  // TrackMan supports initial generation only. Replacing summaries after staff
  // review would destroy associations, comparison links, and other review state.
  if (batch.parserMode === "trackman-result") {
    const existingSummaryCount = await db.importClubSummary.count({
      where: { importBatchId: batchId },
    });
    if (existingSummaryCount > 0) {
      return NextResponse.json(
        {
          error:
            "TrackMan summaries already exist and cannot be regenerated destructively. Recalculate the affected summary from its associated shots instead.",
        },
        { status: 409 },
      );
    }

    await db.$transaction(async (tx) => {
      await createTrackManClubSummaries(
        tx,
        batchId,
        importRows.map((row) => ({
          id: row.id,
          rowIndex: row.rowIndex,
          rawData: row.rawData as Record<string, unknown>,
        })),
      );
      await tx.importBatch.update({
        where: { id: batchId },
        data: { status: "reviewing" },
      });
    }, { timeout: 15_000 });

    const created = await db.importClubSummary.findMany({
      where: { importBatchId: batchId },
      orderBy: [{ clubName: "asc" }],
    });
    return NextResponse.json({ success: true, summaries: created });
  }

  // ── Aggregate generic-import summaries ──────────────────────────────────────
  const summaries = aggregateTrackManClubSummaries(rawRows);
  if (summaries.length === 0) {
    return NextResponse.json(
      { error: "Aggregation produced no club summaries. Check row data." },
      { status: 422 },
    );
  }

  // ── Persist generic-import summaries using the existing behavior ────────────
  await db.$transaction([
    db.importClubSummary.deleteMany({ where: { importBatchId: batchId } }),
    db.importClubSummary.createMany({
      data: summaries.map((s) => ({
        importBatchId: batchId,
        originalClubName: s.originalClubName,
        clubName: s.clubName,
        tags: s.tags,
        shotCount: s.shotCount,
        avgClubSpeed: s.avgClubSpeed,
        avgBallSpeed: s.avgBallSpeed,
        avgSpinRate: s.avgSpinRate,
        avgMaxHeight: s.avgMaxHeight,
        avgCarry: s.avgCarry,
        avgTotal: s.avgTotal,
        validClubSpeedCount: s.validClubSpeedCount,
        validBallSpeedCount: s.validBallSpeedCount,
        validSpinRateCount: s.validSpinRateCount,
        validMaxHeightCount: s.validMaxHeightCount,
        validCarryCount: s.validCarryCount,
        validTotalCount: s.validTotalCount,
        isManuallyEdited: false,
        includeInReport: true,
      })),
    }),
    db.importBatch.update({
      where: { id: batchId },
      data: { status: "reviewing" },
    }),
  ]);

  // ── Return fresh summaries ──────────────────────────────────────────────────
  const created = await db.importClubSummary.findMany({
    where: { importBatchId: batchId },
    orderBy: [{ clubName: "asc" }],
  });

  return NextResponse.json({ success: true, summaries: created });
}
