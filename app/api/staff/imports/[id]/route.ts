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
