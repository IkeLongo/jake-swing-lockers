import { db } from "@/lib/db";
import {
  upsertRiverCityContact,
  addRiverCityTags,
  sendRiverCitySms,
} from "./providers/riverCityGhl";

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
    // ── 1. Upsert temp RiverCity contact ─────────────────────────────────────
    const contactId = await upsertRiverCityContact({
      firstName: client.firstName,
      lastName: client.lastName,
      phone: client.phone,
    });

    // ── 2. Apply cleanup tag ─────────────────────────────────────────────────
    const cleanupTag =
      process.env.GHL_TAG_RIVERCITY_TEMP_SMS ?? "golf-demo:temp-sms-contact";
    await addRiverCityTags(contactId, [cleanupTag]);

    // ── 3. Apply OTP tracking tag (best-effort) ───────────────────────────────
    const otpTag =
      process.env.GHL_TAG_RIVERCITY_SWING_LOCKER_OTP_SMS ?? "golf-demo:otp-sms";
    try {
      await addRiverCityTags(contactId, [otpTag]);
    } catch {
      // Tracking tag is non-critical — do not fail delivery on tag errors
      console.warn("[deliverSwingLockerOtp] OTP tracking tag failed (ignored)");
    }

    // ── 4. Send SMS ───────────────────────────────────────────────────────────
    const message = `Your Swing Locker verification code is ${plainCode}. It expires in 10 minutes.`;
    await sendRiverCitySms(contactId, message);

    // ── 5. Log success ────────────────────────────────────────────────────────
    await db.ghlSyncEvent.create({
      data: {
        demoSessionId: null,
        ghlContactId: contactId,
        eventType: "otp_sms_delivered",
        status: "success",
        message: `OTP SMS sent to RiverCity contact ${contactId} for golfClientId=${client.id}`,
      },
    });

    console.log(
      `[deliverSwingLockerOtp] SMS delivered to contactId=${contactId} for golfClientId=${client.id}`
    );
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
