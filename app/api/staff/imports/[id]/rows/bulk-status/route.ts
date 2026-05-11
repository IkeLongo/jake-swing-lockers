import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";

const VALID_STATUSES = ["pending", "approved", "rejected"] as const;
type RowStatus = (typeof VALID_STATUSES)[number];

/** Derive batch status when all rows have been set to the same value. */
function deriveBatchStatus(status: RowStatus): string {
  if (status === "approved") return "approved";
  if (status === "pending") return "parsed";
  return "reviewing"; // rejected
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = getStaffSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const batchId = parseInt(id, 10);
  if (isNaN(batchId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const batch = await db.importBatch.findUnique({
    where: { id: batchId },
    select: { id: true },
  });
  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
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

  const result = await db.importRow.updateMany({
    where: { importBatchId: batchId },
    data: { status: status as string },
  });

  const batchStatus = deriveBatchStatus(status as RowStatus);
  await db.importBatch.update({
    where: { id: batchId },
    data: { status: batchStatus },
  });

  return NextResponse.json({ ok: true, updated: result.count, batchStatus });
}
