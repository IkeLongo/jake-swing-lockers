import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import { Prisma } from "@/app/generated/prisma/client";

export async function PATCH(
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

  const rawData = (body as Record<string, unknown>).rawData;
  if (
    rawData === null ||
    typeof rawData !== "object" ||
    Array.isArray(rawData)
  ) {
    return NextResponse.json(
      { error: "rawData must be a plain object" },
      { status: 400 },
    );
  }

  // Confirm the row belongs to this batch
  const row = await db.importRow.findUnique({
    where: { id: rowIdInt },
    select: { id: true, importBatchId: true },
  });
  if (!row || row.importBatchId !== batchId) {
    return NextResponse.json({ error: "Row not found" }, { status: 404 });
  }

  const updated = await db.importRow.update({
    where: { id: rowIdInt },
    data: {
      rawData: rawData as Prisma.InputJsonValue,
      status: "pending",
      validationErrors: Prisma.JsonNull,
    },
    select: {
      id: true,
      rowIndex: true,
      rawData: true,
      status: true,
      validationErrors: true,
    },
  });

  // Editing any row resets the batch to "reviewing" so it gets re-examined
  await db.importBatch.update({
    where: { id: batchId },
    data: { status: "reviewing" },
  });

  return NextResponse.json({ ok: true, row: updated });
}
