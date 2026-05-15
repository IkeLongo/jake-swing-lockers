import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalizeIdentifier } from "@/lib/auth/normalize";
import { phoneSearchCandidates } from "@/lib/auth/phoneSearchCandidates";
import { generateOtp, hashOtp } from "@/lib/auth/otp";
import {
  deliverStaffOtpSms,
  deliverStaffOtpEmail,
} from "@/lib/ghl/deliverStaffOtp";

// Generic response sent for every outcome that isn't an outright bad request.
// Never reveals whether the identifier corresponds to a real staff account.
const GENERIC_SUCCESS = {
  success: true,
  message: "If this staff account exists, a code has been sent.",
} as const;

// OTP validity window: 10 minutes
const OTP_TTL_MS = 10 * 60 * 1000;

// Minimum gap between OTP requests for the same user
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
  const { value: normalizedValue, type: identifierType } =
    normalizeIdentifier(rawIdentifier);
  console.log("[staff request-code] started", { identifierType });
  // ── 4 + 5. Look up active StaffUser ───────────────────────────────────────
  try {
    const staffUser = await db.staffUser.findFirst({
      where: {
        ...(identifierType === "email"
          ? { email: normalizedValue }
          : { phone: { in: phoneSearchCandidates(rawIdentifier) } }),
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
      },
    });

    // Unknown or inactive account — return generic response, no OTP created
    if (!staffUser) {
      console.log("[staff request-code] staff user not found", { identifierType });
      return NextResponse.json(GENERIC_SUCCESS);
    }

    console.log("[staff request-code] staff user found", {
      staffUserId: staffUser.id,
      hasEmail: Boolean(staffUser.email),
      hasPhone: Boolean(staffUser.phone),
    });

    // ── 6. Resend cooldown ─────────────────────────────────────────────────
    const recentOtp = await db.staffOtp.findFirst({
      where: {
        staffUserId: staffUser.id,
        usedAt: null,
        expiresAt: { gt: new Date() },
        createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_MS) },
      },
      select: { id: true },
    });

    if (recentOtp) {
      console.log("[staff request-code] cooldown active", { staffUserId: staffUser.id });
      // Return generic success — never reveal cooldown state publicly
      return NextResponse.json(GENERIC_SUCCESS);
    }

    // ── 7. Invalidate old unused OTPs for this user ────────────────────────
    await db.staffOtp.updateMany({
      where: {
        staffUserId: staffUser.id,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });

    // ── 8. Generate new OTP ────────────────────────────────────────────────
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

    // ── 9. Dev-only logging (never runs in production) ─────────────────────
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[staff-OTP] Code for ${rawIdentifier} (normalized: ${normalizedValue}): ${plainCode}`,
      );
    }

    // ── 10. Deliver OTP ────────────────────────────────────────────────────
    const deliveryChannel = identifierType === "phone" ? "sms" : "email";
    console.log("[staff request-code] delivery decision", {
      staffUserId: staffUser.id,
      identifierType,
      deliveryChannel,
      hasEmail: Boolean(staffUser.email),
      hasPhone: Boolean(staffUser.phone),
      smsProviderMode: process.env.GHL_SMS_PROVIDER_MODE ?? null,
      envPresent: {
        GHL_SWINGLOCKER_LOCATION_ID: Boolean(process.env.GHL_SWINGLOCKER_LOCATION_ID),
        GHL_SWINGLOCKER_PRIVATE_TOKEN: Boolean(process.env.GHL_SWINGLOCKER_PRIVATE_TOKEN),
        GHL_RIVERCITY_LOCATION_ID: Boolean(process.env.GHL_RIVERCITY_LOCATION_ID),
        GHL_RIVERCITY_PRIVATE_TOKEN: Boolean(process.env.GHL_RIVERCITY_PRIVATE_TOKEN),
      },
    });

    if (identifierType === "phone") {
      if (
        process.env.GHL_SMS_PROVIDER_MODE === "rivercity_temp" &&
        staffUser.phone
      ) {
        console.log("[staff request-code] SMS delivery starting", { staffUserId: staffUser.id });
        void deliverStaffOtpSms(staffUser, plainCode)
          .then(() => {
            console.log("[staff request-code] SMS delivery resolved", { staffUserId: staffUser.id });
          })
          .catch((err) => {
            console.error("[staff request-code] SMS delivery rejected", {
              staffUserId: staffUser.id,
              deliveryChannel: "sms",
              error: err instanceof Error ? err.message : String(err),
            });
          });
      } else {
        console.log("[staff request-code] SMS delivery skipped", {
          staffUserId: staffUser.id,
          smsProviderMode: process.env.GHL_SMS_PROVIDER_MODE ?? null,
          hasPhone: Boolean(staffUser.phone),
        });
      }
    } else {
      if (staffUser.email) {
        console.log("[staff request-code] email delivery starting", { staffUserId: staffUser.id });
        void deliverStaffOtpEmail(staffUser, plainCode)
          .then(() => {
            console.log("[staff request-code] email delivery resolved", { staffUserId: staffUser.id });
          })
          .catch((err) => {
            console.error("[staff request-code] email delivery rejected", {
              staffUserId: staffUser.id,
              deliveryChannel: "email",
              error: err instanceof Error ? err.message : String(err),
            });
          });
      } else {
        console.log("[staff request-code] email delivery skipped", {
          staffUserId: staffUser.id,
          hasEmail: Boolean(staffUser.email),
        });
      }
    }

    return NextResponse.json(GENERIC_SUCCESS);
  } catch (err) {
    console.error("[staff request-code] Unexpected error:", err);
    return NextResponse.json(
      { success: false, message: "An unexpected error occurred." },
      { status: 500 },
    );
  }
}

