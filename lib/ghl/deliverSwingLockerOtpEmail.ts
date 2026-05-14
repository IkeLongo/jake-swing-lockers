import { db } from "@/lib/db";
import { ghlFetch } from "./client";
import { upsertContact } from "./contacts";
import { renderSwingLockerOtpEmail } from "@/lib/email/renderSwingLockerOtpEmail";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OtpEmailDeliveryClient {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string;
  phone?: string | null;
}

export interface DeliverSwingLockerOtpEmailResult {
  delivered: boolean;
  error?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getLocationId(): string {
  const id = process.env.GHL_SWINGLOCKER_LOCATION_ID;
  if (!id) throw new Error("Missing GHL_SWINGLOCKER_LOCATION_ID environment variable.");
  return id;
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

/**
 * Deliver a Swing Locker OTP to a customer via email through the SwingLocker
 * GHL subaccount's Conversations API.
 *
 * Used as:
 *   - Primary delivery when the client has no phone number
 *   - Fallback delivery when SMS delivery fails
 *
 * GHL receives only the final composed message string. The plaintext OTP
 * code is never stored in GHL contact fields or workflow variables.
 *
 * Steps:
 *   1. Upsert SwingLocker contact (creates if not found)
 *   2. Send email via GHL Conversations API (type: "Email")
 *   3. Log GhlSyncEvent
 *
 * On any failure: logs event, returns { delivered: false, error }.
 */
export async function deliverSwingLockerOtpEmail(
  client: OtpEmailDeliveryClient,
  plainCode: string
): Promise<DeliverSwingLockerOtpEmailResult> {
  console.log("[deliverSwingLockerOtpEmail] started:", {
    golfClientId: client.id,
    targetEmail: client.email,
  });

  try {
    // ── 1. Upsert SwingLocker contact ─────────────────────────────────────────
    const { id: contactId } = await upsertContact({
      firstName: client.firstName,
      lastName: client.lastName,
      email: client.email,
      phone: client.phone ?? null,
    });

    console.log("[deliverSwingLockerOtpEmail] contact upserted:", { contactId });

    // ── 2. Build email content ────────────────────────────────────────────────
    const { subject, html, text: plainText } = renderSwingLockerOtpEmail({
      code: plainCode,
      firstName: client.firstName,
    });

    // ── 3. Send via GHL Conversations API ─────────────────────────────────────
    const locationId = getLocationId();

    console.log("[deliverSwingLockerOtpEmail] calling GHL Conversations API:", {
      contactId,
      locationId,
      emailTo: client.email,
      subject,
    });

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

    // ── 4. Log success ────────────────────────────────────────────────────────
    console.log("[deliverSwingLockerOtpEmail] GHL API call succeeded, logging event");

    await db.ghlSyncEvent.create({
      data: {
        demoSessionId: null,
        ghlContactId: contactId,
        eventType: "otp_email_delivered",
        status: "success",
        message: `OTP email sent via SwingLocker contact ${contactId} for golfClientId=${client.id}`,
      },
    });

    console.log("[deliverSwingLockerOtpEmail] delivered successfully:", {
      golfClientId: client.id,
      contactId,
    });

    return { delivered: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[deliverSwingLockerOtpEmail] Email delivery failed:", errorMessage);

    // Best-effort: log failure event
    try {
      await db.ghlSyncEvent.create({
        data: {
          demoSessionId: null,
          ghlContactId: null,
          eventType: "otp_email_failed",
          status: "error",
          message: `golfClientId=${client.id}: ${errorMessage}`,
        },
      });
    } catch {
      // suppress secondary DB error
    }

    return { delivered: false, error: errorMessage };
  }
}
