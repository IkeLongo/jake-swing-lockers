import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalizeIdentifier } from "@/lib/auth/normalize";
import { verifyOtpHash } from "@/lib/auth/otp";
import {
  SWING_LOCKER_SESSION_COOKIE,
  createSwingLockerSessionPayload,
  signSwingLockerSessionToken,
} from "@/lib/auth/swing-locker-session";

// Session lifetime: 24 hours (must match createSwingLockerSessionPayload default)
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;

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
  if (typeof rawCode !== "string" || !/^\d{6}$/.test(rawCode)) {
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
    // ── 5. Find GolfClient ───────────────────────────────────────────────────
    const client = await db.golfClient.findFirst({
      where:
        identifierType === "email"
          ? { email: normalizedValue }
          : { phone: normalizedValue },
      select: { id: true },
    });

    // ── 6. Unknown client — generic failure ──────────────────────────────────
    if (!client) {
      return NextResponse.json(INVALID_RESPONSE, { status: 401 });
    }

    // ── 7. Find latest valid (unused, non-expired) OTP ───────────────────────
    const otp = await db.swingLockerOtp.findFirst({
      where: {
        golfClientId: client.id,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, codeHash: true },
    });

    if (!otp) {
      return NextResponse.json(INVALID_RESPONSE, { status: 401 });
    }

    // ── 8. Verify code (timing-safe) ─────────────────────────────────────────
    const isValid = verifyOtpHash(rawCode, otp.codeHash);

    // ── 9. Invalid code — generic failure ────────────────────────────────────
    if (!isValid) {
      return NextResponse.json(INVALID_RESPONSE, { status: 401 });
    }

    // ── 10a. Consume OTP ─────────────────────────────────────────────────────
    await db.swingLockerOtp.update({
      where: { id: otp.id },
      data: { usedAt: new Date() },
    });

    // ── 10b. Sign session token ───────────────────────────────────────────────
    const payload = createSwingLockerSessionPayload(
      client.id,
      SESSION_DURATION_MS,
    );
    const token = signSwingLockerSessionToken(payload);

    // ── 10c. Build response and set HTTP-only cookie ──────────────────────────
    const res = NextResponse.json({
      success: true,
      message: "Verification successful.",
    });

    res.cookies.set(SWING_LOCKER_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(SESSION_DURATION_MS / 1000),
    });

    return res;
  } catch (err) {
    console.error("[swing-locker-auth/verify-code] Unexpected error:", err);
    return NextResponse.json(
      { success: false, message: "An unexpected error occurred." },
      { status: 500 },
    );
  }
}
