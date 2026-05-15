import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { StaffRole } from "@/app/generated/prisma/client";
import { requireAdminStaffSession } from "@/lib/auth/requireAdminStaffSession";
import { staffCreateSchema } from "@/lib/validations/staff-create";
import { normalizeEmail, normalizePhone } from "@/lib/auth/normalize";
import { syncStaffUserContact } from "@/lib/ghl/syncStaffUserContact";

// ── GET /api/staff/admin/staff ─────────────────────────────────────────────────
//
// List all staff users. Requires admin role.

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdminStaffSession(req);
  if (!auth.valid) {
    const statusCode = auth.reason === "no_session" ? 401 : 403;
    return NextResponse.json({ error: `Access denied: ${auth.reason}` }, { status: statusCode });
  }

  const staffUsers = await db.staffUser.findMany({
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ staffUsers });
}

// ── POST /api/staff/admin/staff ────────────────────────────────────────────────
//
// Create a new staff user with the provided name, email, phone, and role.
// Requires admin role. Returns 201 on success, 4xx on validation/auth failure.

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 1. Check admin authorization ────────────────────────────────────────────
  const auth = await requireAdminStaffSession(req);
  if (!auth.valid) {
    const statusCode = auth.reason === "no_session" ? 401 : 403;
    return NextResponse.json(
      { error: `Staff creation denied: ${auth.reason}` },
      { status: statusCode },
    );
  }

  // ── 2. Parse JSON body ──────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  // ── 3. Validate input ───────────────────────────────────────────────────────
  const parsed = staffCreateSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors as Record<
      string,
      string[]
    >;
    return NextResponse.json(
      {
        error: "Validation failed",
        fieldErrors,
      },
      { status: 400 },
    );
  }

  const data = parsed.data;

  // ── 4. Normalize email and phone ────────────────────────────────────────────
  const normalizedEmail = data.email ? normalizeEmail(data.email) : null;
  const normalizedPhone = data.phone ? normalizePhone(data.phone) : null;

  // ── 5. Check for duplicate email ────────────────────────────────────────────
  if (normalizedEmail) {
    const existingEmail = await db.staffUser.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    if (existingEmail) {
      return NextResponse.json(
        { error: "Email address is already in use" },
        { status: 409 },
      );
    }
  }

  // ── 6. Check for duplicate phone ────────────────────────────────────────────
  if (normalizedPhone) {
    const existingPhone = await db.staffUser.findUnique({
      where: { phone: normalizedPhone },
      select: { id: true },
    });
    if (existingPhone) {
      return NextResponse.json(
        { error: "Phone number is already in use" },
        { status: 409 },
      );
    }
  }

  // ── 7. Create staff user ────────────────────────────────────────────────────
  let newStaffUser: { id: number };
  try {
    newStaffUser = await db.staffUser.create({
      data: {
        name: data.name,
        email: normalizedEmail,
        phone: normalizedPhone,
        role: data.role as StaffRole,
        isActive: true,
      },
      select: { id: true },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/staff/admin/staff] StaffUser creation failed:", message);
    return NextResponse.json(
      { error: "Failed to create staff user. Please try again." },
      { status: 500 },
    );
  }

  // ── 8. Sync to GHL (non-blocking) ───────────────────────────────────────────
  // Fire-and-forget; syncStaffUserContact handles errors and logging
  void syncStaffUserContact(newStaffUser.id).catch((err) => {
    console.error(
      "[POST /api/staff/admin/staff] GHL sync failed for staff user",
      newStaffUser.id,
      err,
    );
  });

  // ── 9. Return success ───────────────────────────────────────────────────────
  return NextResponse.json(
    {
      success: true,
      message: "Staff user created successfully",
      staffUserId: newStaffUser.id,
    },
    { status: 201 },
  );
}
