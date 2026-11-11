import { db } from "@/lib/db";
import {
  upsertContact,
  updateContactCustomFields,
  type ContactResolution,
} from "./contacts";
import {
  isCustomerContactSyncEnabled,
  processCustomerContactSync,
} from "./customerContactSyncProcessor";
import { addTagsToContact } from "./tags";
import { upsertGolfDemoOpportunity } from "./opportunities";
import {
  GOLF_DEMO_TAGS,
  buildGolfDemoCustomFields,
  buildGolfDemoSummaries,
  golfDemoOpportunityName,
} from "./golfDemoSyncContent";

// ── Result shape ──────────────────────────────────────────────────────────────

export interface GhlSyncResult {
  success: boolean;
  ghlContactId?: string;
  duplicateResolved?: boolean;
  matchingField?: string;
  customFieldsUpdated?: boolean;
  ghlOpportunityId?: string;
  tagsAdded?: string[];
  error?: string;
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export async function syncGolfDemoToGHL(
  demoSessionId: number
): Promise<GhlSyncResult> {
  // ── 1. Load session with all relations ────────────────────────────────────
  const session = await db.demoSession.findUnique({
    where: { id: demoSessionId },
    include: {
      client: true,
      clubTests: {
        include: { metrics: true },
        orderBy: [{ pairIndex: "asc" }, { clubRole: "asc" }],
      },
    },
  });

  if (!session) {
    return { success: false, error: `DemoSession ${demoSessionId} not found.` };
  }

  const client = session.client;
  const customerContactSyncEnabled = isCustomerContactSyncEnabled();
  const appUrl = process.env.APP_BASE_URL ?? "https://jlgolfsales.rivercitycreatives.com";
  const lockerUrl = `${appUrl}/swing-locker/${session.lockerToken}`;

  // Track the resolved contact ID so the catch block can preserve it
  let resolvedGhlContactId: string | undefined;

  try {
    // ── 2. Upsert GHL contact ───────────────────────────────────────────────
    let resolution: ContactResolution;
    if (customerContactSyncEnabled) {
      const result = await processCustomerContactSync(client.id);
      if (result.status !== "synced") {
        const detail =
          "message" in result && result.message ? ` ${result.message}` : "";
        throw new Error(
          `Customer contact sync is ${result.status}.${detail}`,
        );
      }
      resolution = { id: result.contactId };
    } else {
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
    }
    resolvedGhlContactId = resolution.id;

    // ── 3. Save contact ID to DB immediately (before any later step fails) ──
    await db.golfClient.update({
      where: { id: client.id },
      data: {
        ...(!customerContactSyncEnabled
          ? { ghlContactId: resolvedGhlContactId }
          : {}),
        ghlLastSyncedAt: new Date(),
        ghlSyncStatus: "contact_resolved",
        ghlSyncError: null,
      },
    });

    // ── 4. Build club summary strings ───────────────────────────────────────
    const summaries = buildGolfDemoSummaries(session);
    const { monetaryValue } = summaries;

    // ── 5. Update GHL contact custom fields ─────────────────────────────────
    const customFields = buildGolfDemoCustomFields(
      session,
      summaries,
      lockerUrl,
      new Date().toISOString()
    );

    let customFieldsUpdated = false;
    if (customFields.length > 0) {
      await updateContactCustomFields(resolvedGhlContactId, customFields);
      customFieldsUpdated = true;
    }

    // ── 6. Upsert opportunity ────────────────────────────────────────────────
    const ghlOpportunityId = await upsertGolfDemoOpportunity(
      {
        name: golfDemoOpportunityName(client),
        contactId: resolvedGhlContactId,
        monetaryValue,
      },
      session.ghlOpportunityId
    );

    // ── 7. Add tags to trigger GHL workflow ──────────────────────────────────
    const tagsAdded = [...GOLF_DEMO_TAGS];
    await addTagsToContact(resolvedGhlContactId, tagsAdded);

    // ── 8. Save sync status to DemoSession ───────────────────────────────────
    await db.demoSession.update({
      where: { id: demoSessionId },
      data: {
        lockerUrl,
        ghlOpportunityId,
        ghlLockerReadyTagAddedAt: new Date(),
        ghlLastSyncedAt: new Date(),
        ghlSyncStatus: "synced",
        ghlSyncError: null,
      },
    });

    // ── 9. Mark GolfClient fully synced ──────────────────────────────────────
    await db.golfClient.update({
      where: { id: client.id },
      data: {
        ghlSyncStatus: "synced",
        ghlLastSyncedAt: new Date(),
      },
    });

    // ── 10. Log success event ─────────────────────────────────────────────────
    await db.ghlSyncEvent.create({
      data: {
        demoSessionId,
        ghlContactId: resolvedGhlContactId,
        eventType: "demo_sync",
        status: "success",
        message: `Synced demo session ${demoSessionId} to GHL. Opportunity: ${ghlOpportunityId}`,
      },
    });

    return {
      success: true,
      ghlContactId: resolvedGhlContactId,
      duplicateResolved: resolution.duplicateResolved,
      matchingField: resolution.matchingField,
      customFieldsUpdated,
      ghlOpportunityId,
      tagsAdded,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Persist error state — best-effort (don't throw if this also fails)
    try {
      await db.demoSession.update({
        where: { id: demoSessionId },
        data: {
          ghlLastSyncedAt: new Date(),
          ghlSyncStatus: "failed",
          ghlSyncError: message,
        },
      });
      // Preserve resolved contact ID if we got that far before failing
      await db.golfClient.update({
        where: { id: client.id },
        data: {
          ...(!customerContactSyncEnabled && resolvedGhlContactId
            ? { ghlContactId: resolvedGhlContactId }
            : {}),
          ghlLastSyncedAt: new Date(),
          ghlSyncStatus: "failed",
          ghlSyncError: message,
        },
      });
      await db.ghlSyncEvent.create({
        data: {
          demoSessionId,
          ghlContactId: resolvedGhlContactId ?? client.ghlContactId ?? undefined,
          eventType: "demo_sync",
          status: "error",
          message,
        },
      });
    } catch {
      // suppress secondary error
    }

    return {
      success: false,
      ...(resolvedGhlContactId ? { ghlContactId: resolvedGhlContactId } : {}),
      error: message,
    };
  }
}
