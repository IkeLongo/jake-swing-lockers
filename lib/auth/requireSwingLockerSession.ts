import { type NextRequest } from "next/server";
import {
  SWING_LOCKER_SESSION_COOKIE,
  verifySwingLockerSessionToken,
  type SwingLockerSessionPayload,
} from "./swing-locker-session";

/**
 * Extract and verify the swing locker customer session from an incoming request.
 * Returns the session payload on success, or null if absent / invalid / expired.
 */
export function getSwingLockerSessionFromRequest(
  req: NextRequest
): SwingLockerSessionPayload | null {
  const token = req.cookies.get(SWING_LOCKER_SESSION_COOKIE)?.value;
  if (!token) return null;
  const result = verifySwingLockerSessionToken(token);
  return result.valid ? result.payload : null;
}
