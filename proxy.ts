import { NextResponse } from "next/server";
import type { NextProxy } from "next/server";
import type { NextRequest } from "next/server";
import {
  STAFF_SESSION_COOKIE,
  verifyStaffSessionToken,
} from "@/lib/auth/session";
import {
  SWING_LOCKER_SESSION_COOKIE,
  verifySwingLockerSessionToken,
} from "@/lib/auth/swing-locker-session";

const LOGIN_PATH = "/staff/login";
const DASHBOARD_PATH = "/staff/dashboard";

const SWING_LOCKER_LOGIN_PATH = "/swing-locker/login";
const SWING_LOCKER_DASHBOARD_PATH = "/swing-locker/dashboard";

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

/**
 * Read and verify the swing locker customer session cookie from the request.
 * Returns true if a valid, unexpired session token is present.
 */
function hasValidSwingLockerSession(request: NextRequest): boolean {
  const token = request.cookies.get(SWING_LOCKER_SESSION_COOKIE)?.value;
  if (!token) return false;

  const result = verifySwingLockerSessionToken(token);
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
  if (pathname.startsWith("/staff/")) {
    if (!hasValidSession(request)) {
      const loginUrl = new URL(LOGIN_PATH, request.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  // ── /swing-locker/login ───────────────────────────────────────────────────
  // Authenticated customers visiting the login page are bounced to the dashboard.
  if (pathname === SWING_LOCKER_LOGIN_PATH) {
    if (hasValidSwingLockerSession(request)) {
      return NextResponse.redirect(
        new URL(SWING_LOCKER_DASHBOARD_PATH, request.url),
      );
    }
    return NextResponse.next();
  }

  // ── /swing-locker/dashboard and /swing-locker/dashboard/* ────────────────
  // Unauthenticated customers are redirected to the swing locker login page.
  if (
    pathname === SWING_LOCKER_DASHBOARD_PATH ||
    pathname.startsWith(SWING_LOCKER_DASHBOARD_PATH + "/")
  ) {
    if (!hasValidSwingLockerSession(request)) {
      const loginUrl = new URL(SWING_LOCKER_LOGIN_PATH, request.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  return NextResponse.next();
};

// Only run on matched routes — keeps proxy off public, API, and static routes.
export const config = {
  matcher: [
    "/staff/:path*",
    "/swing-locker/login",
    "/swing-locker/dashboard/:path*",
  ],
};
