import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalizeIdentifier } from "@/lib/auth/normalize";
import { generateOtp, hashOtp } from "@/lib/auth/otp";

// Generic response sent for every outcome that isn't an outright bad request.
// Never reveals whether the identifier corresponds to a real staff account.
const GENERIC_SUCCESS = {
  success: true,
  message: "If this staff account exists, a code has been sent.",
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

  // ── 4 + 5. Look up active StaffUser ───────────────────────────────────────
  try {
    const staffUser = await db.staffUser.findFirst({
      where: {
        ...(identifierType === "email"
          ? { email: normalizedValue }
          : { phone: normalizedValue }),
        isActive: true,
      },
      select: { id: true },
    });

    // Unknown or inactive account — return generic response, no OTP created
    if (!staffUser) {
      return NextResponse.json(GENERIC_SUCCESS);
    }

    // ── 6. Invalidate old unused OTPs for this user ────────────────────────
    await db.staffOtp.updateMany({
      where: {
        staffUserId: staffUser.id,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });

    // ── 7. Generate new OTP ────────────────────────────────────────────────
    const plainCode = generateOtp();
    const codeHash = hashOtp(plainCode);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    await db.staffOtp.create({
      data: {
        staffUserId: staffUser.id,
        codeHash,
        expiresAt,
        usedAt: null,
      },
    });

    // ── 8. Dev-only logging (never runs in production) ─────────────────────
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[OTP] Code for ${rawIdentifier} (normalized: ${normalizedValue}): ${plainCode}`,
      );
    }

    // TODO: deliver OTP via GoHighLevel email/SMS based on identifierType

    return NextResponse.json(GENERIC_SUCCESS);
  } catch (err) {
    console.error("[request-code] Unexpected error:", err);
    return NextResponse.json(
      { success: false, message: "An unexpected error occurred." },
      { status: 500 },
    );
  }
}
