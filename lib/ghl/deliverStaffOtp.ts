import { db } from "@/lib/db";
import { StaffRole } from "@/app/generated/prisma/client";
import { ghlFetch } from "./client";
import { renderOtpEmail } from "@/lib/email/renderOtpEmail";
import {
  TAG_RC_TEMP_SMS,
  TAG_RC_TEMP_STAFF,
  TAG_RC_TEMP_ADMIN,
  TAG_RC_TEMP_SALES_REP,
  TAG_RC_TEMP_SUPPORT,
} from "./tags";
import { syncStaffUserContact } from "./syncStaffUserContact";
import {
  upsertRiverCityContact,
  addRiverCityTags,
  sendRiverCitySms,
} from "./providers/riverCityGhl";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StaffOtpDeliveryClient {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  // App DB role — used for GHL tag mapping only. Never use GHL tags for authorization.
  role: StaffRole;
}

export interface DeliverStaffOtpResult {
  delivered: boolean;
  error?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSwingLockerLocationId(): string {
  const id = process.env.GHL_SWINGLOCKER_LOCATION_ID;
  if (!id) throw new Error("Missing GHL_SWINGLOCKER_LOCATION_ID environment variable.");
  return id;
}

function rcRoleTag(role: StaffRole): string {
  switch (role) {
    case StaffRole.admin:     return TAG_RC_TEMP_ADMIN;
    case StaffRole.sales_rep: return TAG_RC_TEMP_SALES_REP;
    case StaffRole.support:   return TAG_RC_TEMP_SUPPORT;
  }
}

// ── SMS via RiverCity ─────────────────────────────────────────────────────────

/**
 * Deliver a staff OTP via SMS through the RiverCity GHL subaccount.
 *
 * Guard: only active when GHL_SMS_PROVIDER_MODE === "rivercity_temp".
 * Logs staff_otp_sms_delivered / staff_otp_failed GhlSyncEvent.
 */
export async function deliverStaffOtpSms(
  client: StaffOtpDeliveryClient,
  plainCode: string
): Promise<DeliverStaffOtpResult> {
  try {
    if (!client.phone) {
      return { delivered: false, error: "No phone number on staff user." };
    }

    // ── 1. Ensure SwingLocker CRM contact exists with role tags ───────────────
    // Non-blocking: SMS delivery does not depend on SwingLocker sync completing.
    void syncStaffUserContact(client.id).catch((err) => {
      console.error("[deliverStaffOtpSms] SwingLocker sync failed (non-fatal):", err);
    });

    // ── 2. Upsert RiverCity contact ───────────────────────────────────────────
    const contactId = await upsertRiverCityContact({
      firstName: client.name ?? undefined,
      phone: client.phone,
    });

    // ── 3. Tag contact with role-specific temp tags ───────────────────────────
    await addRiverCityTags(contactId, [
      TAG_RC_TEMP_SMS,
      TAG_RC_TEMP_STAFF,
      rcRoleTag(client.role),
    ]);

    // ── 4. Send SMS ───────────────────────────────────────────────────────────
    const message = `Your JL Golf Sales staff verification code is ${plainCode}. It expires in 10 minutes.`;
    await sendRiverCitySms(contactId, message);

    // ── 5. Log success ────────────────────────────────────────────────────────
    await db.ghlSyncEvent.create({
      data: {
        demoSessionId: null,
        ghlContactId: contactId,
        eventType: "staff_otp_sms_delivered",
        status: "success",
        message: `Staff OTP SMS sent via RiverCity contact ${contactId} for staffUserId=${client.id}`,
      },
    });

    return { delivered: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[deliverStaffOtpSms] SMS delivery failed:", errorMessage);

    try {
      await db.ghlSyncEvent.create({
        data: {
          demoSessionId: null,
          ghlContactId: null,
          eventType: "staff_otp_failed",
          status: "error",
          message: `Staff OTP SMS delivery failed for staffUserId=${client.id}: ${errorMessage}`,
        },
      });
    } catch (logErr) {
      console.error("[deliverStaffOtpSms] Failed to log error event:", logErr);
    }

    return { delivered: false, error: errorMessage };
  }
}

// ── Email via SwingLocker GHL ─────────────────────────────────────────────────

/**
 * Deliver a staff OTP via email through the SwingLocker GHL subaccount.
 *
 * Logs staff_otp_email_delivered / staff_otp_failed GhlSyncEvent.
 */
export async function deliverStaffOtpEmail(
  client: StaffOtpDeliveryClient,
  plainCode: string
): Promise<DeliverStaffOtpResult> {
  try {
    if (!client.email) {
      return { delivered: false, error: "No email address on staff user." };
    }

    // ── 1. Ensure SwingLocker contact exists with role tags ───────────────────
    // Blocking: email delivery requires the contact to exist in SwingLocker GHL.
    await syncStaffUserContact(client.id);

    // ── 2. Get resolved contact ID ────────────────────────────────────────────
    const staffRecord = await db.staffUser.findUnique({
      where: { id: client.id },
      select: { ghlContactId: true },
    });
    const contactId = staffRecord?.ghlContactId;
    if (!contactId) {
      return {
        delivered: false,
        error: "Failed to resolve SwingLocker GHL contact for email delivery.",
      };
    }

    // ── 3. Build email content ────────────────────────────────────────────────
    const { subject, html, text: plainText } = renderOtpEmail({
      code: plainCode,
      title: "Your staff verification code",
      introText:
        "Use the verification code below to finish signing in to your JL Golf Sales staff account.",
      firstName: client.name,
      footerNote: "This code was requested to sign in to the JL Golf Sales staff portal.",
    });

    // ── 4. Send via GHL Conversations API ─────────────────────────────────────
    const locationId = getSwingLockerLocationId();

    await ghlFetch<unknown>("/conversations/messages", {
      method: "POST",
      body: JSON.stringify({
        type: "Email",
        contactId,
        locationId,
        subject,
        html,
        message: plainText,
        emailTo: client.email,
      }),
    });

    // ── 5. Log success ────────────────────────────────────────────────────────
    await db.ghlSyncEvent.create({
      data: {
        demoSessionId: null,
        ghlContactId: contactId,
        eventType: "staff_otp_email_delivered",
        status: "success",
        message: `Staff OTP email sent via SwingLocker contact ${contactId} for staffUserId=${client.id}`,
      },
    });

    return { delivered: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[deliverStaffOtpEmail] Email delivery failed:", errorMessage);

    try {
      await db.ghlSyncEvent.create({
        data: {
          demoSessionId: null,
          ghlContactId: null,
          eventType: "staff_otp_failed",
          status: "error",
          message: `Staff OTP email delivery failed for staffUserId=${client.id}: ${errorMessage}`,
        },
      });
    } catch (logErr) {
      console.error("[deliverStaffOtpEmail] Failed to log error event:", logErr);
    }

    return { delivered: false, error: errorMessage };
  }
}
