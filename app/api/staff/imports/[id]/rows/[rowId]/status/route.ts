import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";

const VALID_STATUSES = ["pending", "approved", "rejected"] as const;
type RowStatus = (typeof VALID_STATUSES)[number];

/** Recalculate ImportBatch.status based on all its rows' statuses. */
async function recalcBatchStatus(batchId: number): Promise<string> {
  const counts = await db.importRow.groupBy({
    by: ["status"],
    where: { importBatchId: batchId },
    _count: { status: true },
  });
  const total = counts.reduce((s, c) => s + c._count.status, 0);
  if (total === 0) return "parsed";
  const approved =
    counts.find((c) => c.status === "approved")?._count.status ?? 0;
  const pending =
    counts.find((c) => c.status === "pending")?._count.status ?? 0;
  if (approved === total) return "approved";
  if (pending === total) return "parsed";
  return "reviewing";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; rowId: string }> },
) {
  const session = getStaffSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, rowId } = await params;
  const batchId = parseInt(id, 10);
  const rowIdInt = parseInt(rowId, 10);
  if (isNaN(batchId) || isNaN(rowIdInt)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const status = (body as Record<string, unknown>).status;
  if (!VALID_STATUSES.includes(status as RowStatus)) {
    return NextResponse.json({ error: "Invalid status value" }, { status: 400 });
  }

  // Confirm the row belongs to this batch before updating
  const row = await db.importRow.findUnique({
    where: { id: rowIdInt },
    select: { id: true, importBatchId: true },
  });
  if (!row || row.importBatchId !== batchId) {
    return NextResponse.json({ error: "Row not found" }, { status: 404 });
  }

  await db.importRow.update({
    where: { id: rowIdInt },
    data: { status: status as string },
  });

  const batchStatus = await recalcBatchStatus(batchId);
  await db.importBatch.update({
    where: { id: batchId },
    data: { status: batchStatus },
  });

  return NextResponse.json({ ok: true, batchStatus });
}
