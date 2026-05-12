import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import { normalizeEmail, normalizePhone } from "@/lib/auth/normalize";

// ── Request body types ────────────────────────────────────────────────────────

interface ConfirmBodyBase {
  demoDate: unknown;
  notes?: unknown;
}

interface ConfirmBodyExistingClient extends ConfirmBodyBase {
  existingGolfClientId: unknown;
  firstName?: never;
  lastName?: never;
  email?: never;
  phone?: never;
}

interface ConfirmBodyNewClient extends ConfirmBodyBase {
  existingGolfClientId?: never;
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  phone?: unknown;
}

type ConfirmBody = ConfirmBodyExistingClient | ConfirmBodyNewClient;

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const session = getStaffSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // ── Resolve batch ID ────────────────────────────────────────────────────────
  const { id } = await params;
  const batchId = parseInt(id, 10);
  if (isNaN(batchId)) {
    return NextResponse.json({ error: "Invalid batch ID." }, { status: 400 });
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: ConfirmBody;
  try {
    body = (await req.json()) as ConfirmBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // ── Validate demoDate ───────────────────────────────────────────────────────
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

  // ── Validate notes ──────────────────────────────────────────────────────────
  const notes =
    body.notes && typeof body.notes === "string" ? body.notes.trim() : null;

  // ── Verify batch exists and is not already confirmed ─────────────────────────
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) {
    return NextResponse.json(
      { error: "Import batch not found." },
      { status: 404 },
    );
  }
  if (batch.demoSessionId !== null) {
    return NextResponse.json(
      { error: "This import has already been confirmed." },
      { status: 409 },
    );
  }

  // ── Resolve GolfClient ───────────────────────────────────────────────────────
  let client: { id: number; firstName: string | null; lastName: string | null };

  if (body.existingGolfClientId !== undefined) {
    // Use an existing client
    const existingId =
      typeof body.existingGolfClientId === "number"
        ? body.existingGolfClientId
        : parseInt(String(body.existingGolfClientId), 10);

    if (isNaN(existingId)) {
      return NextResponse.json(
        { error: "Invalid existingGolfClientId." },
        { status: 400 },
      );
    }

    const found = await db.golfClient.findUnique({
      where: { id: existingId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!found) {
      return NextResponse.json(
        { error: "GolfClient not found." },
        { status: 404 },
      );
    }
    client = found;
  } else {
    // Create or match a client from provided fields
    const rawFirstName =
      typeof body.firstName === "string" ? body.firstName.trim() : "";
    const rawLastName =
      typeof body.lastName === "string" ? body.lastName.trim() : "";
    const rawEmail =
      typeof body.email === "string" ? body.email.trim() : "";
    const rawPhone =
      typeof body.phone === "string" ? body.phone.trim() : "";

    const hasName = rawFirstName.length > 0 || rawLastName.length > 0;
    const hasContact = rawEmail.length > 0 || rawPhone.length > 0;

    if (!hasName && !hasContact) {
      return NextResponse.json(
        {
          error:
            "Provide either an existing client ID or at least a name and/or contact info for a new client.",
        },
        { status: 400 },
      );
    }

    const email = rawEmail ? normalizeEmail(rawEmail) : null;
    const phone = rawPhone ? normalizePhone(rawPhone) : null;

    // Dedup: check if a client already exists with this email or phone
    const existing = await db.golfClient.findFirst({
      where: {
        OR: [
          ...(email ? [{ email }] : []),
          ...(phone ? [{ phone }] : []),
        ],
      },
      select: { id: true, firstName: true, lastName: true },
    });

    if (existing) {
      // Reuse the matched client rather than creating a duplicate
      client = existing;
    } else {
      client = await db.golfClient.create({
        data: {
          firstName: rawFirstName || null,
          lastName: rawLastName || null,
          email,
          phone,
        },
        select: { id: true, firstName: true, lastName: true },
      });
    }
  }

  // ── Determine sales rep name for the session ─────────────────────────────────
  const staffUser = await db.staffUser.findUnique({
    where: { id: session.staffUserId },
    select: { name: true },
  });
  const salesRep = staffUser?.name ?? null;

  // ── Create DemoSession placeholder ──────────────────────────────────────────
  const demoSession = await db.demoSession.create({
    data: {
      clientId: client.id,
      lockerToken: randomUUID(),
      demoDate: demoParsed,
      salesRep,
      notes,
      journeyStage: "demo_completed",
    },
    select: {
      id: true,
      lockerToken: true,
      demoDate: true,
      salesRep: true,
      notes: true,
    },
  });

  // ── Link ImportBatch to the new DemoSession ──────────────────────────────────
  await db.importBatch.update({
    where: { id: batchId },
    data: {
      demoSessionId: demoSession.id,
      status: "approved",
    },
  });

  // TODO: Create DemoClubTest records (one per ImportClubSummary where includeInReport === true)
  // TODO: Create ClubTestMetrics for each DemoClubTest from ImportClubSummary averages
  // TODO: Generate Swing Locker page and populate demoSession.lockerUrl
  // TODO: Trigger GHL sync (contact create/update + opportunity + locker-ready tag)

  return NextResponse.json({
    success: true,
    demoSessionId: demoSession.id,
    golfClientId: client.id,
    clientName: [client.firstName, client.lastName].filter(Boolean).join(" ") || null,
    lockerToken: demoSession.lockerToken,
  });
}
