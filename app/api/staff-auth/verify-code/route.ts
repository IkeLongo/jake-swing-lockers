import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalizeIdentifier } from "@/lib/auth/normalize";
import { phoneSearchCandidates } from "@/lib/auth/phoneSearchCandidates";
import { verifyOtpHash } from "@/lib/auth/otp";
import {
  STAFF_SESSION_COOKIE,
  createStaffSessionPayload,
  signStaffSessionToken,
} from "@/lib/auth/session";

// Session lifetime: 8 hours (must match createStaffSessionPayload default)
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

// Generic failure — never reveals which field caused the problem
const INVALID_RESPONSE = {
  success: false,
  message: "Invalid or expired code.",
} as const;

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 1. Parse body ──────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  // ── 2. Validate identifier ─────────────────────────────────────────────────
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).identifier !== "string" ||
    (body as Record<string, string>).identifier.trim() === ""
  ) {
    return NextResponse.json(
      { success: false, message: "identifier is required." },
      { status: 400 },
    );
  }

  // ── 3. Validate code ───────────────────────────────────────────────────────
  const rawCode = (body as Record<string, unknown>).code;
  if (
    typeof rawCode !== "string" ||
    !/^\d{6}$/.test(rawCode)
  ) {
    return NextResponse.json(
      { success: false, message: "code must be a 6-digit string." },
      { status: 400 },
    );
  }

  const rawIdentifier = (body as Record<string, string>).identifier;

  // ── 4. Normalize identifier ────────────────────────────────────────────────
  const { value: normalizedValue, type: identifierType } =
    normalizeIdentifier(rawIdentifier);

  try {
    // ── 5. Find active StaffUser ─────────────────────────────────────────────
    const staffUser = await db.staffUser.findFirst({
      where: {
        ...(identifierType === "email"
          ? { email: normalizedValue }
          : { phone: { in: phoneSearchCandidates(rawIdentifier) } }),
        isActive: true,
      },
      select: { id: true },
    });

    // ── 6. Unknown / inactive account — generic failure ──────────────────────
    if (!staffUser) {
      return NextResponse.json(INVALID_RESPONSE, { status: 401 });
    }

    // ── 7. Find latest valid (unused, non-expired) OTP ───────────────────────
    const otp = await db.staffOtp.findFirst({
      where: {
        staffUserId: staffUser.id,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, codeHash: true, failedAttempts: true },
    });

    if (!otp) {
      return NextResponse.json(INVALID_RESPONSE, { status: 401 });
    }

    // ── 8. Verify code (timing-safe) ─────────────────────────────────────────
    const isValid = verifyOtpHash(rawCode, otp.codeHash);

    // ── 9. Invalid code — increment attempt counter, invalidate at max ────────
    if (!isValid) {
      const MAX_ATTEMPTS = 5;
      const newFailedAttempts = otp.failedAttempts + 1;

      await db.staffOtp.update({
        where: { id: otp.id },
        data: {
          failedAttempts: newFailedAttempts,
          ...(newFailedAttempts >= MAX_ATTEMPTS ? { usedAt: new Date() } : {}),
        },
      });

      return NextResponse.json(INVALID_RESPONSE, { status: 401 });
    }

    // ── 10a. Consume OTP ─────────────────────────────────────────────────────
    await db.staffOtp.update({
      where: { id: otp.id },
      data: { usedAt: new Date() },
    });

    // ── 10b. Sign session token ───────────────────────────────────────────────
    const payload = createStaffSessionPayload(staffUser.id, SESSION_DURATION_MS);
    const token = signStaffSessionToken(payload);

    // ── 10c. Build response and set HTTP-only cookie ──────────────────────────
    const res = NextResponse.json({ success: true, message: "Verification successful." });

    res.cookies.set(STAFF_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(SESSION_DURATION_MS / 1000), // cookie maxAge is in seconds
    });

    return res;
  } catch (err) {
    console.error("[verify-code] Unexpected error:", err);
    return NextResponse.json(
      { success: false, message: "An unexpected error occurred." },
      { status: 500 },
    );
  }
}
