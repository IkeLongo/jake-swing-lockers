import { NextResponse } from "next/server";
import type { NextProxy } from "next/server";
import type { NextRequest } from "next/server";
import {
  STAFF_SESSION_COOKIE,
  verifyStaffSessionToken,
} from "@/lib/auth/session";

const LOGIN_PATH = "/staff/login";
const DASHBOARD_PATH = "/staff/dashboard";

/**
 * Read and verify the staff session cookie from the request.
 * Returns true if a valid, unexpired session token is present.
 */
function hasValidSession(request: NextRequest): boolean {
  const token = request.cookies.get(STAFF_SESSION_COOKIE)?.value;
  if (!token) return false;

  const result = verifyStaffSessionToken(token);
  return result.valid;
}

export const proxy: NextProxy = (request) => {
  const { pathname } = request.nextUrl;

  // ── /staff/login ──────────────────────────────────────────────────────────
  // Authenticated users visiting the login page are bounced to the dashboard.
  if (pathname === LOGIN_PATH) {
    if (hasValidSession(request)) {
      return NextResponse.redirect(new URL(DASHBOARD_PATH, request.url));
    }
    return NextResponse.next();
  }

  // ── All other /staff/* routes ────────────────────────────────────────────
  // Unauthenticated requests are redirected to the login page.
  if (!hasValidSession(request)) {
    const loginUrl = new URL(LOGIN_PATH, request.url);
    // Preserve the original destination so the login page can redirect back
    // after successful verification (used in Phase 7+ when login reads this).
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
};

// Only run on /staff/* — keeps proxy off public, API, and static routes.
export const config = {
  matcher: ["/staff/:path*"],
};
