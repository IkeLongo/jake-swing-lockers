import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import { normalizeEmail, normalizePhone } from "@/lib/auth/normalize";

// ── PATCH /api/staff/clients/[id] ─────────────────────────────────────────────
// Update a GolfClient's profile fields.
// Body: { firstName?, lastName?, email?, phone? }
// All fields optional — only provided fields are updated.

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = getStaffSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid client ID." }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Ensure the client exists
  const existing = await db.golfClient.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  const patch: {
    firstName?: string;
    lastName?: string;
    email?: string | null;
    phone?: string | null;
  } = {};

  if (typeof body.firstName === "string") {
    const v = body.firstName.trim();
    if (!v) {
      return NextResponse.json({ error: "firstName cannot be empty." }, { status: 400 });
    }
    patch.firstName = v;
  }
  if (typeof body.lastName === "string") {
    const v = body.lastName.trim();
    if (!v) {
      return NextResponse.json({ error: "lastName cannot be empty." }, { status: 400 });
    }
    patch.lastName = v;
  }
  if (typeof body.email === "string") {
    patch.email = body.email.trim() ? normalizeEmail(body.email.trim()) : null;
  }
  if (typeof body.phone === "string") {
    patch.phone = body.phone.trim() ? normalizePhone(body.phone.trim()) : null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update." }, { status: 400 });
  }

  const updated = await db.golfClient.update({
    where: { id },
    data: patch,
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, updatedAt: true },
  });

  return NextResponse.json({ success: true, client: updated });
}

// ── DELETE /api/staff/clients/[id] ────────────────────────────────────────────
// Permanently delete a GolfClient.
// Safety: blocked if the client has any DemoSession records attached.
// Does NOT cascade-delete sessions — staff must remove sessions first.

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = getStaffSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid client ID." }, { status: 400 });
  }

  const client = await db.golfClient.findUnique({
    where: { id },
    select: { id: true, _count: { select: { demoSessions: true } } },
  });
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  if (client._count.demoSessions > 0) {
    return NextResponse.json(
      {
        error: `This client cannot be deleted because they have ${client._count.demoSessions} demo session${client._count.demoSessions === 1 ? "" : "s"} attached. Delete those sessions first.`,
      },
      { status: 400 },
    );
  }

  await db.golfClient.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
