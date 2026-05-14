import { db } from "@/lib/db";
import {
  upsertRiverCityContact,
  addRiverCityTags,
  sendRiverCitySms,
} from "./providers/riverCityGhl";
import { syncGolfClientContact } from "./syncGolfClientContact";
import { TAG_RC_TEMP_SMS, TAG_RC_TEMP_CLIENT } from "./tags";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OtpDeliveryClient {
  id: number;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
}

export interface DeliverSwingLockerOtpResult {
  delivered: boolean;
  error?: string;
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

/**
 * Deliver a Swing Locker OTP to a customer via RiverCity GHL SMS.
 *
 * This function is the ONLY place the OTP plaintext is passed to an external
 * system. GHL receives only the final composed message string — the plaintext
 * code is never stored in a GHL contact field or workflow variable.
 *
 * Steps:
 *   1. Upsert RiverCity temp contact by phone
 *   2. Apply cleanup tag (golf-demo:temp-sms-contact) for future bulk deletion
 *   3. Apply OTP tracking tag (golf-demo:otp-sms) — best-effort, not required
 *   4. Send SMS via GHL Conversations API
 *   5. Log GhlSyncEvent
 *
 * On any failure: logs event, returns { delivered: false, error }.
 * Caller (request-code route) must still return generic success regardless.
 */
export async function deliverSwingLockerOtp(
  client: OtpDeliveryClient,
  plainCode: string
): Promise<DeliverSwingLockerOtpResult> {
  if (!client.phone) {
    return { delivered: false, error: "Client has no phone number." };
  }

  try {
    // ── 1. Non-blocking SwingLocker sync — ensures golf-demo:client tag ─────────
    void syncGolfClientContact(client.id).catch((err) => {
      console.error("[deliverSwingLockerOtp] SwingLocker sync failed (non-blocking):", err);
    });

    // ── 2. Upsert temp RiverCity contact ─────────────────────────────────────
    const contactId = await upsertRiverCityContact({
      firstName: client.firstName,
      lastName: client.lastName,
      phone: client.phone,
    });

    // ── 3. Apply identity + cleanup tags ─────────────────────────────────────
    await addRiverCityTags(contactId, [TAG_RC_TEMP_SMS, TAG_RC_TEMP_CLIENT]);

    // ── 4. Send SMS ───────────────────────────────────────────────────────────
    const message = `Your Swing Locker verification code is ${plainCode}. It expires in 10 minutes.`;
    await sendRiverCitySms(contactId, message);

    // ── 5. Log success ─────────────────────────────────────────────────────────
    await db.ghlSyncEvent.create({
      data: {
        demoSessionId: null,
        ghlContactId: contactId,
        eventType: "otp_sms_delivered",
        status: "success",
        message: `OTP SMS sent to RiverCity contact ${contactId} for golfClientId=${client.id}`,
      },
    });

    return { delivered: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[deliverSwingLockerOtp] SMS delivery failed:", errorMessage);

    // Best-effort: log failure event
    try {
      await db.ghlSyncEvent.create({
        data: {
          demoSessionId: null,
          ghlContactId: null,
          eventType: "otp_sms_failed",
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
