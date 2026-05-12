import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import { normalizeEmail, normalizePhone } from "@/lib/auth/normalize";

// ── DELETE /api/staff/demo-sessions/[id] ─────────────────────────────────────
//
// Permanently deletes a DemoSession and all session-specific staged data.
//
// Cascade order (respects FK constraints):
//   1. GhlSyncEvent          → references DemoSession
//   2. ImportClubSummary     → references ImportBatch
//   3. ImportRow             → references ImportBatch
//   4. ImportBatch           → references DemoSession
//   5. ClubTestMetrics       → references DemoClubTest
//   6. DemoClubTest          → references DemoSession
//   7. DemoSession           → root record deleted last
//
// SAFE: GolfClient is intentionally NOT deleted.
//
// TODO (finalized sessions): When a session is finalized and published to a
// Swing Locker, additional cleanup will be needed (e.g. revoking the locker
// URL, notifying GHL). For now, finalized sessions can still be hard-deleted
// via this route.

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const staffSession = getStaffSessionFromRequest(req);
  if (!staffSession) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // ── Parse ID ────────────────────────────────────────────────────────────────
  const { id: idStr } = await params;
  const sessionId = parseInt(idStr, 10);
  if (isNaN(sessionId) || sessionId <= 0) {
    return NextResponse.json(
      { error: "Invalid session ID." },
      { status: 400 },
    );
  }

  // ── Verify session exists ────────────────────────────────────────────────────
  const demoSession = await db.demoSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true },
  });
  if (!demoSession) {
    return NextResponse.json(
      { error: "Demo session not found." },
      { status: 404 },
    );
  }

  // ── Cascade delete inside a transaction ─────────────────────────────────────
  try {
    await db.$transaction(async (tx) => {
      // 1. GHL sync events
      await tx.ghlSyncEvent.deleteMany({
        where: { demoSessionId: sessionId },
      });

      // 2–4. Import staging data (batches → summaries + rows)
      const batches = await tx.importBatch.findMany({
        where: { demoSessionId: sessionId },
        select: { id: true },
      });
      const batchIds = batches.map((b) => b.id);
      if (batchIds.length > 0) {
        await tx.importClubSummary.deleteMany({
          where: { importBatchId: { in: batchIds } },
        });
        await tx.importRow.deleteMany({
          where: { importBatchId: { in: batchIds } },
        });
        await tx.importBatch.deleteMany({
          where: { id: { in: batchIds } },
        });
      }

      // 5–6. Finalized club data (ClubTestMetrics → DemoClubTest)
      const clubTests = await tx.demoClubTest.findMany({
        where: { demoSessionId: sessionId },
        select: { id: true },
      });
      const clubTestIds = clubTests.map((ct) => ct.id);
      if (clubTestIds.length > 0) {
        await tx.clubTestMetrics.deleteMany({
          where: { clubTestId: { in: clubTestIds } },
        });
        await tx.demoClubTest.deleteMany({
          where: { id: { in: clubTestIds } },
        });
      }

      // 7. DemoSession — GolfClient is intentionally NOT deleted
      await tx.demoSession.delete({ where: { id: sessionId } });
    });
  } catch (err) {
    console.error("[DELETE /api/staff/demo-sessions/[id]]", err);
    return NextResponse.json(
      { error: "Failed to delete demo session. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}

// ── PATCH /api/staff/demo-sessions/[id] ──────────────────────────────────────
//
// Updates a DemoSession's demoDate, notes, and optionally reassigns it to a
// different GolfClient.
//
// Body: { demoDate: string (ISO), notes?: string,
//         existingGolfClientId?: number,
//         newClient?: { firstName, lastName, email, phone } }
//
// Client resolution:
//   - existingGolfClientId  → reassign to that existing GolfClient
//   - newClient             → find-or-create by email/phone, then reassign
//   - neither               → keep current clientId unchanged
//
// Safety rules:
//   - Finalized sessions cannot be edited (returns 409).
//   - GolfClient records are NEVER mutated; only DemoSession.clientId changes.

interface PatchSessionBody {
  demoDate?: unknown;
  notes?: unknown;
  existingGolfClientId?: unknown;
  newClient?: unknown;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const staffSession = getStaffSessionFromRequest(req);
  if (!staffSession) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // ── Parse ID ────────────────────────────────────────────────────────────────
  const { id: idStr } = await params;
  const sessionId = parseInt(idStr, 10);
  if (isNaN(sessionId) || sessionId <= 0) {
    return NextResponse.json(
      { error: "Invalid session ID." },
      { status: 400 },
    );
  }

  // ── Verify session exists ────────────────────────────────────────────────────
  const existing = await db.demoSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, clientId: true },
  });
  if (!existing) {
    return NextResponse.json(
      { error: "Demo session not found." },
      { status: 404 },
    );
  }

  // ── Block finalized sessions ─────────────────────────────────────────────────
  if (existing.status === "finalized") {
    return NextResponse.json(
      { error: "Finalized sessions cannot be edited." },
      { status: 409 },
    );
  }

  // ── Parse + validate body ────────────────────────────────────────────────────
  let body: PatchSessionBody;
  try {
    body = (await req.json()) as PatchSessionBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.demoDate || typeof body.demoDate !== "string") {
    return NextResponse.json(
      { error: "demoDate is required." },
      { status: 400 },
    );
  }
  const demoParsed = new Date(body.demoDate);
  if (isNaN(demoParsed.getTime())) {
    return NextResponse.json(
      { error: "demoDate must be a valid ISO date string." },
      { status: 400 },
    );
  }

  const notes =
    typeof body.notes === "string" && body.notes.trim()
      ? body.notes.trim()
      : null;

  // ── Resolve new clientId ─────────────────────────────────────────────────────
  let resolvedClientId: number = existing.clientId;

  if (
    body.existingGolfClientId !== undefined &&
    body.existingGolfClientId !== null
  ) {
    // Reassign to an existing GolfClient by ID
    const clientId =
      typeof body.existingGolfClientId === "number"
        ? body.existingGolfClientId
        : parseInt(String(body.existingGolfClientId), 10);
    if (isNaN(clientId) || clientId <= 0) {
      return NextResponse.json(
        { error: "Invalid existingGolfClientId." },
        { status: 400 },
      );
    }
    const clientExists = await db.golfClient.findUnique({
      where: { id: clientId },
      select: { id: true },
    });
    if (!clientExists) {
      return NextResponse.json(
        { error: "The specified client does not exist." },
        { status: 404 },
      );
    }
    resolvedClientId = clientId;
  } else if (body.newClient !== null && typeof body.newClient === "object") {
    // Find-or-create a GolfClient from the supplied fields
    const nc = body.newClient as Record<string, unknown>;
    const firstName =
      typeof nc.firstName === "string" ? nc.firstName.trim() : "";
    const lastName =
      typeof nc.lastName === "string" ? nc.lastName.trim() : "";
    const rawEmail = typeof nc.email === "string" ? nc.email.trim() : "";
    const rawPhone = typeof nc.phone === "string" ? nc.phone.trim() : "";

    if (!firstName) {
      return NextResponse.json(
        { error: "newClient.firstName is required." },
        { status: 400 },
      );
    }
    if (!lastName) {
      return NextResponse.json(
        { error: "newClient.lastName is required." },
        { status: 400 },
      );
    }
    if (!rawEmail && !rawPhone) {
      return NextResponse.json(
        {
          error:
            "At least one of email or phone is required for the new client.",
        },
        { status: 400 },
      );
    }

    const email = rawEmail ? normalizeEmail(rawEmail) : null;
    const phone = rawPhone ? normalizePhone(rawPhone) : null;

    // Dedup: find existing client by email or phone
    const orClauses: Array<{ email: string } | { phone: string }> = [];
    if (email) orClauses.push({ email });
    if (phone) orClauses.push({ phone });

    const dupClient = await db.golfClient.findFirst({
      where: { OR: orClauses },
      select: { id: true },
    });

    if (dupClient) {
      resolvedClientId = dupClient.id;
    } else {
      const created = await db.golfClient.create({
        data: { firstName, lastName, email, phone },
        select: { id: true },
      });
      resolvedClientId = created.id;
    }
  }

  // ── Update DemoSession ───────────────────────────────────────────────────────
  try {
    await db.demoSession.update({
      where: { id: sessionId },
      data: { demoDate: demoParsed, notes, clientId: resolvedClientId },
    });
  } catch (err) {
    console.error("[PATCH /api/staff/demo-sessions/[id]]", err);
    return NextResponse.json(
      { error: "Failed to update demo session. Please try again." },
      { status: 500 },
    );
  }

  // ── Fetch updated client for response ────────────────────────────────────────
  const client = await db.golfClient.findUnique({
    where: { id: resolvedClientId },
    select: { firstName: true, lastName: true, email: true, phone: true },
  });

  return NextResponse.json({
    success: true,
    firstName: client?.firstName ?? "",
    lastName: client?.lastName ?? "",
    email: client?.email ?? "",
    phone: client?.phone ?? "",
    demoDate: demoParsed.toISOString(),
    notes,
  });
}
