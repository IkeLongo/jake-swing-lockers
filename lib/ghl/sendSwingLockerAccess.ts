import { db } from "@/lib/db";
import { upsertContact } from "./contacts";
import { addTagsToContact } from "./tags";
import {
  upsertRiverCityContact,
  addRiverCityTags,
} from "./providers/riverCityGhl";
import { updateGolfDemoOpportunity, STAGE_SWING_LOCKER_SENT } from "./opportunities";

// ── Result shape ──────────────────────────────────────────────────────────────

export interface SendSwingLockerAccessResult {
  success: boolean;
  error?: string;
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

/**
 * Sync the customer to SwingLocker GHL and apply the access invite email tag.
 * Optionally prepare a temporary RiverCity contact for future SMS transport.
 *
 * This function does NOT generate or send OTPs, SMS messages, or emails.
 * GHL workflows triggered by the applied tag handle all customer communication.
 *
 * Called after the send-access route has already:
 *   - validated staff auth
 *   - validated session is finalized
 *   - validated client has email or phone
 *   - set DemoSession.accessInviteStatus = "pending"
 */
export async function sendSwingLockerAccess(
  demoSessionId: number
): Promise<SendSwingLockerAccessResult> {
  // ── 1. Load session + client ──────────────────────────────────────────────
  const session = await db.demoSession.findUnique({
    where: { id: demoSessionId },
    select: {
      id: true,
      ghlOpportunityId: true,
      client: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          ghlContactId: true,
        },
      },
    },
  });

  if (!session) {
    return { success: false, error: `DemoSession ${demoSessionId} not found.` };
  }

  const client = session.client;

  // Track for error-path GhlSyncEvent
  let resolvedGhlContactId: string | undefined;

  try {
    // ── 2. Sync contact to SwingLocker GHL ───────────────────────────────────
    const resolution = await upsertContact(
      {
        firstName: client.firstName,
        lastName: client.lastName,
        email: client.email,
        phone: client.phone,
      },
      client.ghlContactId
    );
    resolvedGhlContactId = resolution.id;

    // ── 3. Save resolved contact ID to GolfClient ────────────────────────────
    if (resolvedGhlContactId !== client.ghlContactId) {
      await db.golfClient.update({
        where: { id: client.id },
        data: {
          ghlContactId: resolvedGhlContactId,
          ghlLastSyncedAt: new Date(),
          ghlSyncStatus: "contact_resolved",
          ghlSyncError: null,
        },
      });
    }

    // ── 4. Apply SwingLocker access invite email tag ──────────────────────────
    const emailTag =
      process.env.GHL_TAG_SWING_LOCKER_ACCESS_EMAIL ?? "golf-demo:locker-sent";
    await addTagsToContact(resolvedGhlContactId, [emailTag]);

    // ── 4b. Move GHL opportunity to Swing Locker Sent stage ──────────────────
    if (session.ghlOpportunityId) {
      try {
        await updateGolfDemoOpportunity(session.ghlOpportunityId, {
          pipelineStageId: STAGE_SWING_LOCKER_SENT(),
        });
      } catch (stageErr) {
        console.warn(
          "[sendSwingLockerAccess] Failed to move opportunity to Swing Locker Sent stage:",
          stageErr
        );
      }
    }

    // ── 5. Mark invite as sent ────────────────────────────────────────────────
    await db.demoSession.update({
      where: { id: demoSessionId },
      data: {
        accessInviteStatus: "sent",
        accessInviteSentAt: new Date(),
        accessInviteError: null,
      },
    });

    // ── 6. Log SwingLocker success event ─────────────────────────────────────
    await db.ghlSyncEvent.create({
      data: {
        demoSessionId,
        ghlContactId: resolvedGhlContactId,
        eventType: "access_invite_email_tag_success",
        status: "success",
        message: `Applied tag "${emailTag}" to contact ${resolvedGhlContactId}`,
      },
    });

    // ── 7. RiverCity temporary contact (optional) ─────────────────────────────
    // Only runs when:
    //   - GHL_SMS_PROVIDER_MODE === "rivercity_temp"
    //   - client has a phone number
    // RiverCity is a temporary SMS transport layer only. Contact IDs are NOT
    // stored on GolfClient — they are not CRM source-of-truth.
    if (
      process.env.GHL_SMS_PROVIDER_MODE === "rivercity_temp" &&
      client.phone
    ) {
      try {
        const rcContactId = await upsertRiverCityContact({
          firstName: client.firstName,
          lastName: client.lastName,
          phone: client.phone,
        });

        const smsTag =
          process.env.GHL_TAG_RIVERCITY_TEMP_SMS ?? "golf-demo:temp-sms-contact";
        await addRiverCityTags(rcContactId, [smsTag]);

        await db.ghlSyncEvent.create({
          data: {
            demoSessionId,
            ghlContactId: rcContactId,
            eventType: "access_invite_rivercity_tag_success",
            status: "success",
            message: `Applied RiverCity cleanup tag "${smsTag}" to temp contact ${rcContactId}`,
          },
        });
      } catch (rcErr) {
        const rcWarning = rcErr instanceof Error ? rcErr.message : String(rcErr);
        console.warn("[sendSwingLockerAccess] RiverCity step failed:", rcWarning);

        await db.ghlSyncEvent.create({
          data: {
            demoSessionId,
            ghlContactId: resolvedGhlContactId,
            eventType: "access_invite_rivercity_warning",
            status: "warning",
            message: rcWarning,
          },
        });

        // Persist warning on DemoSession — does NOT change "sent" status
        await db.demoSession.update({
          where: { id: demoSessionId },
          data: { accessInviteError: `RiverCity warning: ${rcWarning}` },
        });
      }
    }

    return { success: true };
  } catch (err) {
    // ── Email step failed — mark invite as failed ─────────────────────────
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sendSwingLockerAccess] SwingLocker step failed:", message);

    try {
      await db.demoSession.update({
        where: { id: demoSessionId },
        data: {
          accessInviteStatus: "failed",
          accessInviteError: message,
        },
      });

      await db.ghlSyncEvent.create({
        data: {
          demoSessionId,
          ghlContactId: resolvedGhlContactId ?? client.ghlContactId ?? undefined,
          eventType: "access_invite_failed",
          status: "error",
          message,
        },
      });
    } catch {
      // suppress secondary DB error
    }

    return { success: false, error: message };
  }
}
