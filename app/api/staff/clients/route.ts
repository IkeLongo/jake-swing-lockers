import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import { normalizeEmail, normalizePhone } from "@/lib/auth/normalize";

// ── GET /api/staff/clients ────────────────────────────────────────────────────
// Returns all GolfClient records with demo session counts and last demo date.
// Supports optional ?q= search across firstName, lastName, email, phone.

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = getStaffSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";

  const where =
    q.length >= 2
      ? {
          OR: [
            { firstName: { contains: q } },
            { lastName: { contains: q } },
            { email: { contains: q } },
            { phone: { contains: q } },
          ],
        }
      : {};

  const clients = await db.golfClient.findMany({
    where,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 200,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      createdAt: true,
      _count: { select: { demoSessions: true } },
      demoSessions: {
        orderBy: { demoDate: "desc" },
        take: 1,
        select: { demoDate: true },
      },
    },
  });

  const result = clients.map((c) => ({
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    phone: c.phone,
    createdAt: c.createdAt,
    demoSessionCount: c._count.demoSessions,
    lastDemoDate: c.demoSessions[0]?.demoDate ?? null,
  }));

  return NextResponse.json({ clients: result });
}

// ── POST /api/staff/clients ───────────────────────────────────────────────────
// Create a new GolfClient.
// Body: { firstName, lastName, email?, phone? }
// Validation: firstName + lastName required; at least email OR phone required.
// Deduplication: rejects if a client with the same email or phone already exists.

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = getStaffSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const firstName =
    typeof body.firstName === "string" ? body.firstName.trim() : "";
  const lastName =
    typeof body.lastName === "string" ? body.lastName.trim() : "";
  const rawEmail =
    typeof body.email === "string" ? body.email.trim() : "";
  const rawPhone =
    typeof body.phone === "string" ? body.phone.trim() : "";

  if (!firstName) {
    return NextResponse.json(
      { error: "firstName is required." },
      { status: 400 },
    );
  }
  if (!lastName) {
    return NextResponse.json(
      { error: "lastName is required." },
      { status: 400 },
    );
  }
  if (!rawEmail && !rawPhone) {
    return NextResponse.json(
      { error: "At least one of email or phone is required." },
      { status: 400 },
    );
  }

  const email = rawEmail ? normalizeEmail(rawEmail) : null;
  const phone = rawPhone ? normalizePhone(rawPhone) : null;

  // Dedup check
  const orClauses = [
    ...(email ? [{ email }] : []),
    ...(phone ? [{ phone }] : []),
  ];
  const existing = await db.golfClient.findFirst({
    where: { OR: orClauses },
    select: { id: true, firstName: true, lastName: true },
  });
  if (existing) {
    const name =
      [existing.firstName, existing.lastName].filter(Boolean).join(" ") ||
      `#${existing.id}`;
    return NextResponse.json(
      {
        error: `A client with that email or phone already exists: ${name} (ID ${existing.id}).`,
        existingClientId: existing.id,
      },
      { status: 409 },
    );
  }

  const client = await db.golfClient.create({
    data: { firstName, lastName, email, phone },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, createdAt: true },
  });

  return NextResponse.json({ success: true, client }, { status: 201 });
}
