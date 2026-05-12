import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import { aggregateTrackManClubSummaries } from "@/lib/imports/trackmanAggregation";

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
    select: { id: true, status: true },
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
    select: { rawData: true },
  });

  if (importRows.length === 0) {
    return NextResponse.json(
      { error: "No rows found for this batch." },
      { status: 422 },
    );
  }

  // rawData is Json — cast to Record<string, unknown> for aggregation
  const rawRows = importRows.map(
    (r) => r.rawData as Record<string, unknown>,
  );

  // ── Aggregate ───────────────────────────────────────────────────────────────
  const summaries = aggregateTrackManClubSummaries(rawRows);

  if (summaries.length === 0) {
    return NextResponse.json(
      { error: "Aggregation produced no club summaries. Check row data." },
      { status: 422 },
    );
  }

  // ── Persist (delete existing, insert fresh) ─────────────────────────────────
  await db.$transaction([
    db.importClubSummary.deleteMany({ where: { importBatchId: batchId } }),
    db.importClubSummary.createMany({
      data: summaries.map((s) => ({
        importBatchId: batchId,
        originalClubName: s.originalClubName,
        clubName: s.clubName,
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
