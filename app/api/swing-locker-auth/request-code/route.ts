import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalizeIdentifier } from "@/lib/auth/normalize";
import { generateOtp, hashOtp } from "@/lib/auth/otp";
import { deliverSwingLockerOtp } from "@/lib/ghl/deliverSwingLockerOtp";
import { phoneSearchCandidates } from "@/lib/auth/phoneSearchCandidates";

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
  const { type: identifierType } = normalizeIdentifier(rawIdentifier);

  // ── 4. Look up GolfClient ──────────────────────────────────────────────────
  try {
    let whereClause: { email: string } | { phone: { in: string[] } };
    let debugCandidates: { email?: string; phoneCandidates?: string[] };

    if (identifierType === "email") {
      const emailCandidate = rawIdentifier.trim().toLowerCase();
      whereClause = { email: emailCandidate };
      debugCandidates = { email: emailCandidate };
    } else {
      const phoneCandidates = phoneSearchCandidates(rawIdentifier);
      whereClause = { phone: { in: phoneCandidates } };
      debugCandidates = { phoneCandidates };
    }

    console.log("[request-code] lookup candidates:", {
      raw: rawIdentifier,
      identifierType,
      ...debugCandidates,
    });

    const client = await db.golfClient.findFirst({
      where: whereClause,
      select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    });

    // Unknown client — return generic response, no OTP created
    if (!client) {
      console.log("[request-code] skipping SMS delivery — reason: missing client (not found for identifier)");
      return NextResponse.json(GENERIC_SUCCESS);
    }

    console.log("[request-code] client matched:", {
      id: client.id,
      hasPhone: !!client.phone,
      phone: client.phone,
      email: client.email,
      GHL_SMS_PROVIDER_MODE: process.env.GHL_SMS_PROVIDER_MODE,
    });

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
        `[SwingLockerOTP] Code for ${rawIdentifier}: ${plainCode}`,
      );
    }

    // ── 8. Deliver OTP via RiverCity GHL SMS ──────────────────────────────────
    // Runs when: GHL_SMS_PROVIDER_MODE === "rivercity_temp" AND client has a phone.
    // Failure is best-effort — never changes the public response.
    if (
      process.env.GHL_SMS_PROVIDER_MODE === "rivercity_temp" &&
      client.phone
    ) {
      console.log("[request-code] calling deliverSwingLockerOtp");
      void deliverSwingLockerOtp(client, plainCode).catch((err) => {
        console.error("[request-code] Unhandled OTP delivery error:", err);
      });
    } else {
      console.log("[request-code] skipping SMS delivery — reason:", {
        smsMode: process.env.GHL_SMS_PROVIDER_MODE,
        modeMismatch: process.env.GHL_SMS_PROVIDER_MODE !== "rivercity_temp",
        missingPhone: !client.phone,
      });
    }

    return NextResponse.json(GENERIC_SUCCESS);
  } catch (err) {
    console.error("[swing-locker-auth/request-code] Unexpected error:", err);
    return NextResponse.json(
      { success: false, message: "An unexpected error occurred." },
      { status: 500 },
    );
  }
}
