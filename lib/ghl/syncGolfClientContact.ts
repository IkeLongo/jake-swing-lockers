import { db } from "@/lib/db";
import { ContactResolutionError, upsertContact } from "./contacts";
import { isDefiniteGhlNoMutation } from "./client";
import { claimFittingSync, releaseFittingSync } from "./fittingSyncClaim";
import { FITTING_RECONCILIATION_MESSAGE, hasUnresolvedCustomerCreation } from "./syncErrorMarker";
import {
  isCustomerContactSyncEnabled,
  processCustomerContactSync,
} from "./customerContactSyncProcessor";
import {
  addTagsToContact,
  TAG_SL_CLIENT,
  TAG_RC_TEMP_SMS,
  TAG_RC_TEMP_CLIENT,
} from "./tags";
import {
  upsertRiverCityContact,
  addRiverCityTags,
} from "./providers/riverCityGhl";

/**
 * Upsert a GolfClient into the Swing Locker GHL subaccount and apply the
 * golf-demo:client identity tag.
 *
 * Saves ghlContactId / sync status back to the GolfClient record.
 * Never throws — failures are recorded on the DB record and logged.
 *
 * If GHL_SMS_PROVIDER_MODE === "rivercity_temp" and the client has a phone
 * number, also creates a temporary mirror contact in RiverCity for SMS
 * transport. The RiverCity contact ID is NOT stored.
 */
export async function syncGolfClientContact(clientId: number): Promise<void> {
  // ── Load client ────────────────────────────────────────────────────────────
  const select = {
    id: true,
    firstName: true,
    lastName: true,
    email: true,
    phone: true,
    ghlContactId: true,
    ghlContactCreationState: true,
    syncState: {
      select: {
        creationAttemptId: true,
        creationAttemptVersion: true,
        creationAttemptStatus: true,
        creationAttemptedAt: true,
      },
    },
  } as const;
  let client = await db.golfClient.findUnique({
    where: { id: clientId },
    select,
  });

  if (!client) {
    console.warn("[syncGolfClientContact] GolfClient not found:", clientId);
    return;
  }
  const customerContactSyncEnabled = isCustomerContactSyncEnabled();

  // ── Swing Locker upsert ────────────────────────────────────────────────────
  let ghlContactId: string;
  let fittingClaim: { sessionId: number; token: string } | null = null;
  let uncertain = false;

  try {
    if (customerContactSyncEnabled) {
      const result = await processCustomerContactSync(client.id);
      if (result.status !== "synced") {
        const detail =
          "message" in result && result.message ? ` ${result.message}` : "";
        throw new Error(
          `Customer contact sync is ${result.status}.${detail}`,
        );
      }
      ghlContactId = result.contactId;
    } else {
      if (hasUnresolvedCustomerCreation(client)) throw new Error(FITTING_RECONCILIATION_MESSAGE);
      if (!client.ghlContactId) {
        throw new ContactResolutionError(
          "contact_match_requires_review",
          "This customer has no saved GHL contact. Review and approve a contact through the staged fitting workflow before syncing.",
        );
      }
      const fitting = await db.demoSession.findFirst({
        where: { clientId },
        select: { id: true },
        orderBy: { id: "asc" },
      });
      if (fitting) {
        const token = await claimFittingSync(db, fitting.id, clientId);
        if (!token) throw new Error(FITTING_RECONCILIATION_MESSAGE);
        fittingClaim = { sessionId: fitting.id, token };
        client = await db.golfClient.findUnique({ where: { id: clientId }, select });
        if (!client || hasUnresolvedCustomerCreation(client)) {
          throw new Error(FITTING_RECONCILIATION_MESSAGE);
        }
      }
      uncertain = true;
      let resolution;
      try {
        resolution = await upsertContact(
        {
          firstName: client.firstName,
          lastName: client.lastName,
          email: client.email,
          phone: client.phone,
        },
        client.ghlContactId,
        {
          contactMatchPolicy: "require-review",
          requireExistingLink: true,
          ownClientId: client.id,
          findLinkedClients: (contactIds) =>
            db.golfClient.findMany({
              where: {
                id: { not: clientId },
                ghlContactId: { in: contactIds },
              },
              select: {
                id: true,
                firstName: true,
                lastName: true,
                ghlContactId: true,
              },
            }),
        },
        );
      } catch (error) {
        if (error instanceof ContactResolutionError || isDefiniteGhlNoMutation(error)) uncertain = false;
        throw error;
      }
      ghlContactId = resolution.id;
      uncertain = false;
    }

    if (fittingClaim) uncertain = true;
    try {
      await addTagsToContact(ghlContactId, [TAG_SL_CLIENT]);
    } catch (error) {
      if (isDefiniteGhlNoMutation(error)) uncertain = false;
      throw error;
    }

    await db.golfClient.update({
      where: { id: clientId },
      data: {
        ...(!customerContactSyncEnabled ? { ghlContactId } : {}),
        ghlSyncStatus: "synced",
        ghlSyncError: null,
        ghlLastSyncedAt: new Date(),
      },
    });
    uncertain = false;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[syncGolfClientContact] Swing Locker sync failed:", message);
    await db.golfClient.update({
      where: { id: clientId },
      data: {
        ghlSyncStatus: "failed",
        ghlSyncError: message,
      },
    });
    return;
  } finally {
    if (fittingClaim && !uncertain) {
      await releaseFittingSync(db, fittingClaim.sessionId, fittingClaim.token);
    }
  }

  // ── RiverCity temporary mirror (SMS only) ─────────────────────────────────
  if (client.phone && process.env.GHL_SMS_PROVIDER_MODE === "rivercity_temp") {
    try {
      const rcContactId = await upsertRiverCityContact({
        firstName: client.firstName,
        lastName: client.lastName,
        phone: client.phone,
      });
      await addRiverCityTags(rcContactId, [TAG_RC_TEMP_SMS, TAG_RC_TEMP_CLIENT]);
    } catch (err) {
      // RiverCity failure does not affect Swing Locker sync result
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        "[syncGolfClientContact] RiverCity mirror failed (non-fatal):",
        message
      );
    }
  }
}
