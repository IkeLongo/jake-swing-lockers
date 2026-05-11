import type { NextRequest } from "next/server";
import {
  STAFF_SESSION_COOKIE,
  verifyStaffSessionToken,
  type StaffSessionPayload,
} from "@/lib/auth/session";

/**
 * Read and verify the staff session cookie from an API route request.
 *
 * Returns the verified StaffSessionPayload on success, or null if the
 * cookie is absent, malformed, has an invalid signature, or is expired.
 *
 * Use this in API route handlers that need to protect staff-only endpoints.
 * The proxy only covers /staff/* page routes; API routes under /api/staff/*
 * must verify the session themselves.
 */
export function getStaffSessionFromRequest(
  req: NextRequest,
): StaffSessionPayload | null {
  const token = req.cookies.get(STAFF_SESSION_COOKIE)?.value;
  if (!token) return null;

  const result = verifyStaffSessionToken(token);
  return result.valid ? result.payload : null;
}
