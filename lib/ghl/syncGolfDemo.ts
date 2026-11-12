import { db } from "@/lib/db";
import {
  upsertContact,
  updateContactCustomFields,
  ContactResolutionError,
  type ContactResolution,
} from "./contacts";
import { isDefiniteGhlNoMutation } from "./client";
import {
  isCustomerContactSyncEnabled,
  processCustomerContactSync,
} from "./customerContactSyncProcessor";
import { addTagsToContact } from "./tags";
import { upsertGolfDemoOpportunity } from "./opportunities";
import { claimFittingSync, releaseFittingSync } from "./fittingSyncClaim";
import { FITTING_RECONCILIATION_MESSAGE, hasUnresolvedCustomerCreation } from "./syncErrorMarker";
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
  requiresReconciliation?: boolean;
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export async function syncGolfDemoToGHL(
  demoSessionId: number
): Promise<GhlSyncResult> {
  const claim = await claimFittingSync(db, demoSessionId);
  if (!claim) {
    return {
      success: false,
      error: FITTING_RECONCILIATION_MESSAGE,
      requiresReconciliation: true,
    };
  }
  const result = await syncGolfDemoClaimed(demoSessionId, claim);
  if (!result.requiresReconciliation && !await releaseFittingSync(db, demoSessionId, claim)) {
    return { success: false, error: FITTING_RECONCILIATION_MESSAGE, requiresReconciliation: true };
  }
  return result;
}

async function syncGolfDemoClaimed(
  demoSessionId: number,
  claim: string,
): Promise<GhlSyncResult> {
  // ── 1. Load session with all relations ────────────────────────────────────
  let session;
  try {
    session = await db.demoSession.findUnique({
      where: { id: demoSessionId },
      include: {
        client: { include: { syncState: true } },
        clubTests: {
          include: { metrics: true },
          orderBy: [{ pairIndex: "asc" }, { clubRole: "asc" }],
        },
      },
    });
  } catch (error) {
    console.error("[syncGolfDemoToGHL] Could not load the fitting:", error);
    return { success: false, error: "Could not load the fitting for CRM sync." };
  }

  if (!session) {
    return { success: false, error: `DemoSession ${demoSessionId} not found.` };
  }

  const client = session.client;
  if (hasUnresolvedCustomerCreation(client)) {
    return { success: false, error: FITTING_RECONCILIATION_MESSAGE, requiresReconciliation: true };
  }
  const customerContactSyncEnabled = isCustomerContactSyncEnabled();
  const appUrl = process.env.APP_BASE_URL ?? "https://jlgolfsales.rivercitycreatives.com";
  const lockerUrl = `${appUrl}/swing-locker/${session.lockerToken}`;

  // Track the resolved contact ID so the catch block can preserve it
  let resolvedGhlContactId: string | undefined;
  let uncertain = false;

  try {
    // ── 2. Upsert GHL contact ───────────────────────────────────────────────
    let resolution: ContactResolution;
    if (customerContactSyncEnabled) {
      uncertain = true;
      const result = await processCustomerContactSync(client.id, undefined, { sessionId: demoSessionId, token: claim });
      if (result.status !== "synced") {
        uncertain = result.status !== "needs_review" && result.status !== "disabled" &&
          !(result.status === "retry_scheduled" &&
            (result.retrySafety === "no_remote_write" || result.retrySafety === "definitively_rejected"));
        const detail =
          "message" in result && result.message ? ` ${result.message}` : "";
        throw new Error(
          `Customer contact sync is ${result.status}.${detail}`,
        );
      }
      resolution = { id: result.contactId };
    } else {
      uncertain = true;
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
      } catch (error) {
        if (error instanceof ContactResolutionError || isDefiniteGhlNoMutation(error)) uncertain = false;
        throw error;
      }
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
    uncertain = false;

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
      uncertain = true;
      try {
        await updateContactCustomFields(resolvedGhlContactId, customFields);
        uncertain = false;
      } catch (error) {
        if (isDefiniteGhlNoMutation(error)) uncertain = false;
        throw error;
      }
      customFieldsUpdated = true;
    }

    // ── 6. Upsert opportunity ────────────────────────────────────────────────
    uncertain = true;
    let ghlOpportunityId: string;
    try {
      ghlOpportunityId = await upsertGolfDemoOpportunity(
      {
        name: golfDemoOpportunityName(client),
        contactId: resolvedGhlContactId,
        monetaryValue,
      },
      session.ghlOpportunityId
      );
    } catch (error) {
      if (isDefiniteGhlNoMutation(error)) uncertain = false;
      throw error;
    }

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
    uncertain = false;

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
      error: uncertain ? FITTING_RECONCILIATION_MESSAGE : message,
      ...(uncertain ? { requiresReconciliation: true } : {}),
    };
  }
}
