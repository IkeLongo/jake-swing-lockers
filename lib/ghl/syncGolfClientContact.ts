import { db } from "@/lib/db";
import { upsertContact } from "./contacts";
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
  const client = await db.golfClient.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      ghlContactId: true,
    },
  });

  if (!client) {
    console.warn("[syncGolfClientContact] GolfClient not found:", clientId);
    return;
  }
  const customerContactSyncEnabled = isCustomerContactSyncEnabled();

  // ── Swing Locker upsert ────────────────────────────────────────────────────
  let ghlContactId: string;

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
      const resolution = await upsertContact(
        {
          firstName: client.firstName,
          lastName: client.lastName,
          email: client.email,
          phone: client.phone,
        },
        client.ghlContactId,
        {
          contactMatchPolicy: "require-review",
          ownClientId: client.id,
          findLinkedClients: (contactIds) =>
            db.golfClient.findMany({
              where: {
                id: { not: client.id },
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
      ghlContactId = resolution.id;
    }

    await addTagsToContact(ghlContactId, [TAG_SL_CLIENT]);

    await db.golfClient.update({
      where: { id: clientId },
      data: {
        ...(!customerContactSyncEnabled ? { ghlContactId } : {}),
        ghlSyncStatus: "synced",
        ghlSyncError: null,
        ghlLastSyncedAt: new Date(),
      },
    });
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
