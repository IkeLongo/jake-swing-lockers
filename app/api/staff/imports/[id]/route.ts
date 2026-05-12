import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";

// Number of rows returned per request — keeps response payloads predictable
const ROW_LIMIT = 200;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // ── Auth check ─────────────────────────────────────────────────────────────
  const session = getStaffSessionFromRequest(req);
  if (!session) {
    return NextResponse.json(
      { success: false, message: "Unauthorized." },
      { status: 401 },
    );
  }

  // ── Resolve and validate ID ────────────────────────────────────────────────
  const { id } = await params;
  const batchId = parseInt(id, 10);
  if (isNaN(batchId)) {
    return NextResponse.json(
      { success: false, message: "Invalid batch ID." },
      { status: 400 },
    );
  }

  // ── Fetch batch + rows ─────────────────────────────────────────────────────
  const batch = await db.importBatch.findUnique({
    where: { id: batchId },
    include: {
      rows: {
        orderBy: { rowIndex: "asc" },
        take: ROW_LIMIT,
        select: {
          id: true,
          rowIndex: true,
          rawData: true,
          status: true,
          validationErrors: true,
        },
      },
    },
  });

  if (!batch) {
    return NextResponse.json(
      { success: false, message: "Import batch not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({
    success: true,
    batch: {
      id: batch.id,
      originalFileName: batch.originalFileName,
      status: batch.status,
      rowCount: batch.rowCount,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
      rows: batch.rows,
      truncated: batch.rowCount > ROW_LIMIT,
    },
  });
}

// ── DELETE /api/staff/imports/[id] ────────────────────────────────────────────
//
// Hard-deletes a legacy (orphan) ImportBatch and all its staged data.
// Only intended for batches where demoSessionId IS NULL — i.e. uploads that
// predate the client-first session workflow.
//
// Cascade order (respects FK constraints):
//   1. ImportClubSummary  → references ImportBatch
//   2. ImportRow          → references ImportBatch
//   3. ImportBatch        → root record deleted last
//
// GolfClient and DemoSession are never touched.

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const session = getStaffSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // ── Parse ID ────────────────────────────────────────────────────────────────
  const { id: idStr } = await params;
  const batchId = parseInt(idStr, 10);
  if (isNaN(batchId) || batchId <= 0) {
    return NextResponse.json({ error: "Invalid batch ID." }, { status: 400 });
  }

  // ── Verify batch exists ──────────────────────────────────────────────────────
  const batch = await db.importBatch.findUnique({
    where: { id: batchId },
    select: { id: true, originalFileName: true, demoSessionId: true },
  });
  if (!batch) {
    return NextResponse.json(
      { error: "Import batch not found." },
      { status: 404 },
    );
  }

  // ── Cascade delete inside a transaction ─────────────────────────────────────
  try {
    await db.$transaction(async (tx) => {
      await tx.importClubSummary.deleteMany({ where: { importBatchId: batchId } });
      await tx.importRow.deleteMany({ where: { importBatchId: batchId } });
      await tx.importBatch.delete({ where: { id: batchId } });
    });
  } catch (err) {
    console.error("[DELETE /api/staff/imports/[id]]", err);
    return NextResponse.json(
      { error: "Failed to delete import batch. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
