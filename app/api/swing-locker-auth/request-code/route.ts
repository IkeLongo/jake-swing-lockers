import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalizeIdentifier } from "@/lib/auth/normalize";
import { generateOtp, hashOtp } from "@/lib/auth/otp";
import { deliverSwingLockerOtp } from "@/lib/ghl/deliverSwingLockerOtp";
import { deliverSwingLockerOtpEmail } from "@/lib/ghl/deliverSwingLockerOtpEmail";
import { phoneSearchCandidates } from "@/lib/auth/phoneSearchCandidates";

// Generic response sent for every outcome — never reveals account existence.
const GENERIC_SUCCESS = {
  success: true,
  message: "If this account exists, a code has been sent.",
} as const;

// OTP validity window: 10 minutes
const OTP_TTL_MS = 10 * 60 * 1000;
// Minimum gap between OTP requests per client — prevents rapid-fire spam
const RESEND_COOLDOWN_MS = 60 * 1000;

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

  console.log("[swing-locker request-code] started", { identifierType });

  // ── 4. Look up GolfClient ──────────────────────────────────────────────────
  try {
    let whereClause: { email: string } | { phone: { in: string[] } };

    if (identifierType === "email") {
      whereClause = { email: rawIdentifier.trim().toLowerCase() };
    } else {
      whereClause = { phone: { in: phoneSearchCandidates(rawIdentifier) } };
    }

    const client = await db.golfClient.findFirst({
      where: whereClause,
      select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    });

    // Unknown client — return generic response, no OTP created
    if (!client) {
      console.log("[swing-locker request-code] client not found", { identifierType });
      return NextResponse.json(GENERIC_SUCCESS);
    }

    console.log("[swing-locker request-code] client found", {
      clientId: client.id,
      hasEmail: Boolean(client.email),
      hasPhone: Boolean(client.phone),
    });

    // ── 5. Resend cooldown ───────────────────────────────────────────────────
    // Prevent rapid-fire OTP generation — silently accept if one was recently sent.
    const recentOtp = await db.swingLockerOtp.findFirst({
      where: {
        golfClientId: client.id,
        createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_MS) },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (recentOtp) {
      console.log("[swing-locker request-code] cooldown active", { clientId: client.id });
      return NextResponse.json(GENERIC_SUCCESS);
    }

    // ── 6. Invalidate old unused OTPs for this client ────────────────────────
    await db.swingLockerOtp.updateMany({
      where: {
        golfClientId: client.id,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });

    // ── 7. Generate new OTP ──────────────────────────────────────────────────
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

    // ── 8. Dev-only logging ────────────────────────────────────────────────
    if (process.env.NODE_ENV !== "production") {
      console.log(`[SwingLockerOTP] Code for ${rawIdentifier}: ${plainCode}`);
    }

    // ── 9. Deliver OTP — channel matches the identifier type used at login ───
    // Phone input  → SMS only
    // Email input  → Email only
    // No cross-channel fallback in V1.
    const deliveryChannel = identifierType === "phone" ? "sms" : "email";
    console.log("[swing-locker request-code] delivery decision", {
      clientId: client.id,
      identifierType,
      deliveryChannel,
      hasEmail: Boolean(client.email),
      hasPhone: Boolean(client.phone),
      smsProviderMode: process.env.GHL_SMS_PROVIDER_MODE ?? null,
      envPresent: {
        GHL_SWINGLOCKER_LOCATION_ID: Boolean(process.env.GHL_SWINGLOCKER_LOCATION_ID),
        GHL_SWINGLOCKER_PRIVATE_TOKEN: Boolean(process.env.GHL_SWINGLOCKER_PRIVATE_TOKEN),
        GHL_RIVERCITY_LOCATION_ID: Boolean(process.env.GHL_RIVERCITY_LOCATION_ID),
        GHL_RIVERCITY_PRIVATE_TOKEN: Boolean(process.env.GHL_RIVERCITY_PRIVATE_TOKEN),
      },
    });

    if (identifierType === "phone") {
      if (process.env.GHL_SMS_PROVIDER_MODE === "rivercity_temp" && client.phone) {
        console.log("[swing-locker request-code] SMS delivery starting", { clientId: client.id });
        void deliverSwingLockerOtp(client, plainCode)
          .then(() => {
            console.log("[swing-locker request-code] SMS delivery resolved", { clientId: client.id });
          })
          .catch((err) => {
            console.error("[swing-locker request-code] SMS delivery rejected", {
              clientId: client.id,
              deliveryChannel: "sms",
              error: err instanceof Error ? err.message : String(err),
            });
          });
      } else {
        console.log("[swing-locker request-code] SMS delivery skipped", {
          clientId: client.id,
          smsProviderMode: process.env.GHL_SMS_PROVIDER_MODE ?? null,
          hasPhone: Boolean(client.phone),
        });
      }
    } else {
      // identifierType === "email"
      if (client.email) {
        console.log("[swing-locker request-code] email delivery starting", { clientId: client.id });
        void deliverSwingLockerOtpEmail(
          {
            id: client.id,
            firstName: client.firstName,
            lastName: client.lastName,
            email: client.email,
            phone: client.phone,
          },
          plainCode
        )
          .then(() => {
            console.log("[swing-locker request-code] email delivery resolved", { clientId: client.id });
          })
          .catch((err) => {
            console.error("[swing-locker request-code] email delivery rejected", {
              clientId: client.id,
              deliveryChannel: "email",
              error: err instanceof Error ? err.message : String(err),
            });
          });
      } else {
        console.log("[swing-locker request-code] email delivery skipped", {
          clientId: client.id,
          hasEmail: Boolean(client.email),
        });
      }
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
