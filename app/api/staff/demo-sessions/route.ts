import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import { normalizeEmail, normalizePhone } from "@/lib/auth/normalize";

// ── Request body ──────────────────────────────────────────────────────────────

interface CreateSessionBody {
  // Client resolution — one of the two paths must be provided
  existingGolfClientId?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  phone?: unknown;
  // Session fields
  demoDate: unknown;
  notes?: unknown;
}

// ── POST /api/staff/demo-sessions ─────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const session = getStaffSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: CreateSessionBody;
  try {
    body = (await req.json()) as CreateSessionBody;
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

  const notes =
    body.notes && typeof body.notes === "string" ? body.notes.trim() : null;

  // ── Resolve GolfClient ───────────────────────────────────────────────────────
  let client: { id: number; firstName: string | null; lastName: string | null };

  if (body.existingGolfClientId !== undefined && body.existingGolfClientId !== null) {
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

    // Dedup: check for existing client by email or phone
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

  // ── Sales rep name ──────────────────────────────────────────────────────────
  const staffUser = await db.staffUser.findUnique({
    where: { id: session.staffUserId },
    select: { name: true },
  });
  const salesRep = staffUser?.name ?? null;

  // ── Create draft DemoSession ─────────────────────────────────────────────────
  const demoSession = await db.demoSession.create({
    data: {
      clientId: client.id,
      lockerToken: randomUUID(),
      demoDate: demoParsed,
      status: "draft",
      salesRep,
      notes,
      journeyStage: "demo_completed",
    },
    select: {
      id: true,
      status: true,
      demoDate: true,
      lockerToken: true,
    },
  });

  return NextResponse.json({
    success: true,
    demoSessionId: demoSession.id,
    golfClientId: client.id,
    clientName:
      [client.firstName, client.lastName].filter(Boolean).join(" ") || null,
  });
}
