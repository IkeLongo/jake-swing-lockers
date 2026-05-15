import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { StaffRole } from "@/app/generated/prisma/client";
import { getStaffSessionFromRequest } from "./requireStaffSession";

/**
 * Typed result for admin staff session verification.
 * Caller decides how to handle errors (API returns 401/403, etc).
 */
export type RequireAdminStaffSessionResult =
  | { valid: true; staffUserId: number }
  | { valid: false; reason: "no_session" | "not_admin" | "inactive" };

/**
 * Verify that the request has a valid staff session and the user has admin role.
 * Loads the full staff user from DB to check role and isActive status.
 *
 * Returns a typed result; caller is responsible for appropriate HTTP response.
 * Never throws.
 *
 * Usage in API route:
 *   const auth = await requireAdminStaffSession(req);
 *   if (!auth.valid) {
 *     const statusCode = auth.reason === "no_session" ? 401 : 403;
 *     return NextResponse.json({ error: auth.reason }, { status: statusCode });
 *   }
 *   // auth.staffUserId is now guaranteed to be an admin's ID
 */
export async function requireAdminStaffSession(
  req: NextRequest,
): Promise<RequireAdminStaffSessionResult> {
  // ── 1. Check session token ─────────────────────────────────────────────────
  const session = getStaffSessionFromRequest(req);
  if (!session) {
    return { valid: false, reason: "no_session" };
  }

  // ── 2. Load staff user from DB ─────────────────────────────────────────────
  const staff = await db.staffUser.findUnique({
    where: { id: session.staffUserId },
    select: {
      id: true,
      role: true,
      isActive: true,
    },
  });

  // ── 3. Check isActive ──────────────────────────────────────────────────────
  if (!staff?.isActive) {
    return { valid: false, reason: "inactive" };
  }

  // ── 4. Check role is admin ─────────────────────────────────────────────────
  if (staff.role !== StaffRole.admin) {
    return { valid: false, reason: "not_admin" };
  }

  return { valid: true, staffUserId: staff.id };
}
