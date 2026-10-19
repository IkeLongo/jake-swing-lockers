import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import {
  resolveCustomerMatches,
  type CustomerMatchResult,
} from "@/lib/queries/customer-match";

// ── GET /api/staff/imports/[id]/customer-match ────────────────────────────────
//
// Read-only: suggests an existing GolfClient for a staged ImportBatch based on
// the TrackMan player email persisted at upload time. Operates from the
// batch's own identity — never accepts a client-supplied email.
//
// Deterministic email-only matching. Never mutates ImportBatch or GolfClient.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const session = getStaffSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // ── Parse ID ────────────────────────────────────────────────────────────────
  const { id } = await params;
  const batchId = parseInt(id, 10);
  if (isNaN(batchId) || batchId <= 0) {
    return NextResponse.json({ error: "Invalid batch ID." }, { status: 400 });
  }

  // ── Load batch identity ───────────────────────────────────────────────────
  const batch = await db.importBatch.findUnique({
    where: { id: batchId },
    select: { trackmanPlayerEmail: true },
  });
  if (!batch) {
    return NextResponse.json({ error: "Import batch not found." }, { status: 404 });
  }

  // ── Candidates ─────────────────────────────────────────────────────────────
  // Customer volume is currently small and GolfClient.email is not indexed or
  // guaranteed normalized at rest, so equality is checked in application code
  // rather than assuming a DB-level case-insensitive operator for this provider.
  const candidates = await db.golfClient.findMany({
    where: { email: { not: null } },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true },
  });

  const result = resolveCustomerMatches(candidates, batch.trackmanPlayerEmail);

  return NextResponse.json({
    success: true,
    result,
  } satisfies { success: true; result: CustomerMatchResult });
}
