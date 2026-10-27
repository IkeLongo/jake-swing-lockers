import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getTrackManImportBatchMetadata,
  parseFileBuffer,
} from "@/lib/imports/parseFile";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import { createTrackManClubSummaries } from "@/lib/imports/trackmanClubSummaryPersistence";
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

  // ── Optional: link to a draft DemoSession ───────────────────────────────────
  const rawDemoSessionId = formData.get("demoSessionId");
  const demoSessionId =
    rawDemoSessionId && typeof rawDemoSessionId === "string"
      ? parseInt(rawDemoSessionId, 10) || null
      : null;

  // Verify the DemoSession exists and is still in draft state before linking
  if (demoSessionId !== null) {
    const ds = await db.demoSession.findUnique({
      where: { id: demoSessionId },
      select: { id: true, status: true },
    });
    if (!ds) {
      return NextResponse.json(
        { success: false, message: "Demo session not found." },
        { status: 404 },
      );
    }
  }

  // ── Create ImportBatch record ──────────────────────────────────────────────
  const batch = await db.importBatch.create({
    data: {
      originalFileName: file.name,
      uploadedByStaffUserId: session.staffUserId,
      status: "uploaded",
      rowCount: 0,
      ...(demoSessionId !== null ? { demoSessionId } : {}),
    },
  });

  // ── Parse and stage rows ───────────────────────────────────────────────────
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parseResult = parseFileBuffer(buffer, file.name);
    const { rows, parserMode } = parseResult;
    const trackManMetadata = getTrackManImportBatchMetadata(parseResult);

    if (rows.length > 0) {
      await db.importRow.createMany({
        data: rows.map((row, index) => ({
          importBatchId: batch.id,
          rowIndex: index,
          rawData: row as Prisma.InputJsonValue,
          status: "pending",
        })),
      });
    }

    // ── TrackMan: auto-generate club summaries ────────────────────────────────
    // For TrackMan imports the club summary view IS the primary review step, so
    // we generate summaries immediately during upload — no manual button needed.
    let clubSummaryCount = 0;
    if (parserMode === "trackman-result" && rows.length > 0) {
      const persistedRows = await db.importRow.findMany({
        where: { importBatchId: batch.id },
        orderBy: { rowIndex: "asc" },
        select: { id: true, rowIndex: true },
      });
      if (
        persistedRows.length !== rows.length ||
        persistedRows.some((row, index) => row.rowIndex !== index)
      ) {
        throw new Error("TrackMan shot rows could not be mapped to their import order.");
      }

      clubSummaryCount = await db.$transaction(
        (tx) =>
          createTrackManClubSummaries(
            tx,
            batch.id,
            persistedRows.map((row) => ({
              id: row.id,
              rowIndex: row.rowIndex,
              rawData: rows[row.rowIndex] as Record<string, unknown>,
            })),
          ),
        { timeout: 15_000 },
      );
    }

    // TrackMan batches jump straight to "reviewing" (summaries already exist).
    // Generic batches stay at "parsed" until staff manually reviews rows.
    const batchStatus =
      parserMode === "trackman-result" ? "reviewing" : "parsed";

    await db.importBatch.update({
      where: { id: batch.id },
      data: {
        status: batchStatus,
        rowCount: rows.length,
        parserMode,
        ...trackManMetadata,
      },
    });

    // Advance DemoSession status from draft → uploaded
    if (demoSessionId !== null) {
      await db.demoSession.update({
        where: { id: demoSessionId },
        data: { status: "reviewing" },
      });
    }

    return NextResponse.json({
      success: true,
      batchId: batch.id,
      parserMode,
      clubSummaryCount,
    });
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
