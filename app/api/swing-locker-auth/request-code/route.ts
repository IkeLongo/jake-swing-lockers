import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalizeIdentifier } from "@/lib/auth/normalize";
import { generateOtp, hashOtp } from "@/lib/auth/otp";

// Generic response sent for every outcome — never reveals account existence.
const GENERIC_SUCCESS = {
  success: true,
  message: "If this account exists, a code has been sent.",
} as const;

// OTP validity window: 10 minutes
const OTP_TTL_MS = 10 * 60 * 1000;

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

  // ── 2. Validate identifier presence ───────────────────────────────────────
  if (
    typeof body !== "object" ||
    body === null ||
    !("identifier" in body) ||
    typeof (body as Record<string, unknown>).identifier !== "string" ||
    (body as Record<string, string>).identifier.trim() === ""
  ) {
    return NextResponse.json(
      { success: false, message: "identifier is required." },
      { status: 400 },
    );
  }

  const rawIdentifier = (body as Record<string, string>).identifier;

  // ── 3. Normalize identifier ────────────────────────────────────────────────
  const { value: normalizedValue, type: identifierType } =
    normalizeIdentifier(rawIdentifier);

  // ── 4. Look up GolfClient ──────────────────────────────────────────────────
  try {
    const client = await db.golfClient.findFirst({
      where:
        identifierType === "email"
          ? { email: normalizedValue }
          : { phone: normalizedValue },
      select: { id: true },
    });

    // Unknown client — return generic response, no OTP created
    if (!client) {
      return NextResponse.json(GENERIC_SUCCESS);
    }

    // ── 5. Invalidate old unused OTPs for this client ──────────────────────
    await db.swingLockerOtp.updateMany({
      where: {
        golfClientId: client.id,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });

    // ── 6. Generate new OTP ────────────────────────────────────────────────
    const plainCode = generateOtp();
    const codeHash = hashOtp(plainCode);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    await db.swingLockerOtp.create({
      data: {
        golfClientId: client.id,
        codeHash,
        expiresAt,
        usedAt: null,
      },
    });

    // ── 7. Dev-only logging (never runs in production) ─────────────────────
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[SwingLockerOTP] Code for ${rawIdentifier} (normalized: ${normalizedValue}): ${plainCode}`,
      );
    }

    // TODO: deliver OTP via GoHighLevel email/SMS based on identifierType

    return NextResponse.json(GENERIC_SUCCESS);
  } catch (err) {
    console.error("[swing-locker-auth/request-code] Unexpected error:", err);
    return NextResponse.json(
      { success: false, message: "An unexpected error occurred." },
      { status: 500 },
    );
  }
}
