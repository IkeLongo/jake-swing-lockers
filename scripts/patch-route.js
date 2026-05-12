const fs = require('fs');
const path = require('path');

const routeFile = 'app/api/staff/demo-sessions/[id]/route.ts';
const src = fs.readFileSync(routeFile, 'utf8');

const marker = '// ── PATCH /api/staff/demo-sessions/[id]';
const idx = src.indexOf(marker);
if (idx === -1) { console.error('marker not found'); process.exit(1); }

const before = src.slice(0, idx);

const newPatch = `// ── PATCH /api/staff/demo-sessions/[id] ──────────────────────────────────────
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
    const orClauses: { email: string }[] | { phone: string }[] = [];
    if (email) (orClauses as { email: string }[]).push({ email });
    if (phone) (orClauses as { phone: string }[]).push({ phone });

    const dupClient = await db.golfClient.findFirst({
      where: { OR: orClauses as Parameters<typeof db.golfClient.findFirst>[0]["where"] },
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
`;

const result = before + newPatch;
fs.writeFileSync(routeFile, result, 'utf8');
console.log('done, total lines:', result.split('\n').length);
