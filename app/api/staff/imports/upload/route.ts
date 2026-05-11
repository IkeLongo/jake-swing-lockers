import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseFileBuffer } from "@/lib/imports/parseFile";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import type { Prisma } from "@/app/generated/prisma/client";

const ALLOWED_EXTENSIONS = ["csv", "xlsx", "xls"];
// 10 MB ceiling — adjust when TrackMan file sizes are better understood
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth check ─────────────────────────────────────────────────────────────
  const session = getStaffSessionFromRequest(req);
  if (!session) {
    return NextResponse.json(
      { success: false, message: "Unauthorized." },
      { status: 401 },
    );
  }

  // ── Parse multipart form data ──────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid multipart request." },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { success: false, message: "A file field named 'file' is required." },
      { status: 400 },
    );
  }

  // ── Validate file type ─────────────────────────────────────────────────────
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return NextResponse.json(
      {
        success: false,
        message: `Unsupported file type ".${ext}". Only .csv and .xlsx are accepted.`,
      },
      { status: 400 },
    );
  }

  // ── Validate file size ─────────────────────────────────────────────────────
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { success: false, message: "File exceeds the 10 MB size limit." },
      { status: 400 },
    );
  }

  // ── Create ImportBatch record ──────────────────────────────────────────────
  const batch = await db.importBatch.create({
    data: {
      originalFileName: file.name,
      uploadedByStaffUserId: session.staffUserId,
      status: "uploaded",
      rowCount: 0,
    },
  });

  // ── Parse and stage rows ───────────────────────────────────────────────────
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const rows = parseFileBuffer(buffer, file.name);

    if (rows.length > 0) {
      // TODO: When TrackMan column structure is confirmed, run a
      //       validateTrackManRow() here before creating ImportRow records
      //       and populate validationErrors for any malformed rows.
      await db.importRow.createMany({
        data: rows.map((row, index) => ({
          importBatchId: batch.id,
          rowIndex: index,
          rawData: row as Prisma.InputJsonValue,
          status: "pending",
        })),
      });
    }

    await db.importBatch.update({
      where: { id: batch.id },
      data: {
        status: "parsed",
        rowCount: rows.length,
      },
    });

    return NextResponse.json({ success: true, batchId: batch.id });
  } catch (err) {
    // Mark the batch as failed so staff can see it in the list
    await db.importBatch.update({
      where: { id: batch.id },
      data: { status: "failed" },
    });

    console.error("[upload] Parse error for batch", batch.id, ":", err);
    return NextResponse.json(
      {
        success: false,
        message:
          err instanceof Error ? err.message : "Failed to parse the file.",
      },
      { status: 422 },
    );
  }
}
