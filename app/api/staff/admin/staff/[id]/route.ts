import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminStaffSession } from "@/lib/auth/requireAdminStaffSession";
import { StaffRole } from "@/app/generated/prisma/client";
import { normalizeEmail, normalizePhone } from "@/lib/auth/normalize";
import { syncStaffUserContact } from "@/lib/ghl/syncStaffUserContact";
import { staffCreateSchema } from "@/lib/validations/staff-create";

// ── PATCH /api/staff/admin/staff/[id] ─────────────────────────────────────────
//
// Supports two PATCH modes:
//   1) Activation toggle: { isActive: boolean }
//   2) Profile update:    { name, email, phone, role }
//
// Requires admin role.
// An admin cannot deactivate their own currently-logged-in account.
// An admin cannot downgrade their own role away from admin.

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // ── 1. Admin auth ────────────────────────────────────────────────────────────
  const auth = await requireAdminStaffSession(req);
  if (!auth.valid) {
    const statusCode = auth.reason === "no_session" ? 401 : 403;
    return NextResponse.json({ error: `Access denied: ${auth.reason}` }, { status: statusCode });
  }

  // ── 2. Parse and validate ID ─────────────────────────────────────────────────
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid staff user ID." }, { status: 400 });
  }

  // ── 3. Parse body ────────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Request body must be an object." }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;
  const hasIsActive = "isActive" in payload;
  const hasProfileFields =
    "name" in payload ||
    "email" in payload ||
    "phone" in payload ||
    "role" in payload;

  // Keep patch contract explicit to avoid mode ambiguity.
  if (hasIsActive && hasProfileFields) {
    return NextResponse.json(
      { error: "Use either isActive toggle or profile fields in a single request, not both." },
      { status: 400 },
    );
  }

  // ── 4. Verify target staff user exists ───────────────────────────────────────
  const existing = await db.staffUser.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Staff user not found." }, { status: 404 });
  }

  // ── 5A. Activation toggle mode ───────────────────────────────────────────────
  if (hasIsActive) {
    if (typeof payload.isActive !== "boolean") {
      return NextResponse.json(
        { error: "Request body must include isActive as a boolean." },
        { status: 400 },
      );
    }

    // Preserve existing self-deactivation guard behavior.
    if (id === auth.staffUserId) {
      return NextResponse.json(
        { error: "You cannot deactivate your own account." },
        { status: 403 },
      );
    }

    const updated = await db.staffUser.update({
      where: { id },
      data: { isActive: payload.isActive },
      select: { id: true, isActive: true },
    });

    return NextResponse.json({ success: true, staffUser: updated });
  }

  // ── 5B. Profile update mode ─────────────────────────────────────────────────
  if (!hasProfileFields) {
    return NextResponse.json(
      { error: "Request body must include either isActive or profile fields (name, email, phone, role)." },
      { status: 400 },
    );
  }

  const parsed = staffCreateSchema.safeParse(payload);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors as Record<string, string[]>;
    return NextResponse.json({ error: "Validation failed", fieldErrors }, { status: 400 });
  }

  const data = parsed.data;
  const normalizedEmail = data.email ? normalizeEmail(data.email) : null;
  const normalizedPhone = data.phone ? normalizePhone(data.phone) : null;

  if (normalizedEmail) {
    const duplicateEmail = await db.staffUser.findFirst({
      where: {
        id: { not: id },
        email: normalizedEmail,
      },
      select: { id: true },
    });
    if (duplicateEmail) {
      return NextResponse.json(
        {
          error: "Email address is already in use",
          fieldErrors: { email: ["Email address is already in use"] },
        },
        { status: 409 },
      );
    }
  }

  if (normalizedPhone) {
    const duplicatePhone = await db.staffUser.findFirst({
      where: {
        id: { not: id },
        phone: normalizedPhone,
      },
      select: { id: true },
    });
    if (duplicatePhone) {
      return NextResponse.json(
        {
          error: "Phone number is already in use",
          fieldErrors: { phone: ["Phone number is already in use"] },
        },
        { status: 409 },
      );
    }
  }

  if (id === auth.staffUserId && data.role !== "admin") {
    return NextResponse.json(
      {
        error: "You cannot change your own role away from admin.",
        fieldErrors: { role: ["You cannot change your own role away from admin."] },
      },
      { status: 403 },
    );
  }

  const updatedProfile = await db.staffUser.update({
    where: { id },
    data: {
      name: data.name,
      email: normalizedEmail,
      phone: normalizedPhone,
      role: data.role as StaffRole,
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      updatedAt: true,
    },
  });

  void syncStaffUserContact(updatedProfile.id).catch((err) => {
    console.warn(
      "[PATCH /api/staff/admin/staff/[id]] GHL sync failed for staff user",
      updatedProfile.id,
      err,
    );
  });

  return NextResponse.json({ success: true, staffUser: updatedProfile });
}
