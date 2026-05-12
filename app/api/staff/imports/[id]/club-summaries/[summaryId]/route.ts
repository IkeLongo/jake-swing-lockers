import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";

// Editable fields — shotCount and valid*Count are never client-editable
const EDITABLE_NUMERIC_FIELDS = [
  "avgClubSpeed",
  "avgBallSpeed",
  "avgSpinRate",
  "avgMaxHeight",
  "avgCarry",
  "avgTotal",
] as const;

type EditableNumericField = (typeof EDITABLE_NUMERIC_FIELDS)[number];

interface PatchBody {
  clubName?: unknown;
  avgClubSpeed?: unknown;
  avgBallSpeed?: unknown;
  avgSpinRate?: unknown;
  avgMaxHeight?: unknown;
  avgCarry?: unknown;
  avgTotal?: unknown;
  includeInReport?: unknown;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; summaryId: string }> },
): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const session = getStaffSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // ── Resolve IDs ─────────────────────────────────────────────────────────────
  const { id, summaryId } = await params;
  const batchId = parseInt(id, 10);
  const summaryIdNum = parseInt(summaryId, 10);
  if (isNaN(batchId) || isNaN(summaryIdNum)) {
    return NextResponse.json({ error: "Invalid ID." }, { status: 400 });
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  // ── Verify summary belongs to this batch ────────────────────────────────────
  const existing = await db.importClubSummary.findFirst({
    where: { id: summaryIdNum, importBatchId: batchId },
  });
  if (!existing) {
    return NextResponse.json(
      { error: "Club summary not found." },
      { status: 404 },
    );
  }

  // ── Build update payload ────────────────────────────────────────────────────
  // isManuallyEdited is only set true when content fields (clubName, averages) change.
  // includeInReport is a visibility toggle and does NOT count as a manual edit.
  const update: Record<string, unknown> = {};
  let markEdited = false;

  // includeInReport: boolean toggle — does not affect isManuallyEdited
  if ("includeInReport" in body) {
    if (typeof body.includeInReport !== "boolean") {
      return NextResponse.json(
        { error: "includeInReport must be a boolean." },
        { status: 422 },
      );
    }
    update.includeInReport = body.includeInReport;
  }

  // clubName: must be a non-empty string
  if ("clubName" in body) {
    markEdited = true;
    if (typeof body.clubName !== "string" || body.clubName.trim() === "") {
      return NextResponse.json(
        { error: "clubName must be a non-empty string." },
        { status: 422 },
      );
    }
    update.clubName = body.clubName.trim();
  }

  // Numeric fields: string → number, or null when blank
  for (const field of EDITABLE_NUMERIC_FIELDS) {
    if (!(field in body)) continue;
    markEdited = true;
    const raw = body[field as EditableNumericField];

    if (raw === null || raw === undefined || raw === "") {
      update[field] = null;
      continue;
    }

    const n = typeof raw === "number" ? raw : parseFloat(String(raw));
    if (!isFinite(n)) {
      return NextResponse.json(
        { error: `${field} must be a valid number or null.` },
        { status: 422 },
      );
    }
    update[field] = n;
  }
  // Only mark as manually edited when content fields changed
  if (markEdited) {
    update.isManuallyEdited = true;
  }
  // ── Persist ─────────────────────────────────────────────────────────────────
  const updated = await db.importClubSummary.update({
    where: { id: summaryIdNum },
    data: update,
  });

  return NextResponse.json({ success: true, summary: updated });
}
