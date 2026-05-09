import { db } from "@/lib/db";
import { upsertContact, updateContactCustomFields } from "./contacts";
import { addTagsToContact } from "./tags";
import { upsertGolfDemoOpportunity } from "./opportunities";

// ── Env helpers ───────────────────────────────────────────────────────────────

function cf(name: keyof NodeJS.ProcessEnv): string | undefined {
  return process.env[name] ?? undefined;
}

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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const lockerUrl = `${appUrl}/swing-locker/${session.lockerToken}`;

  // Track the resolved contact ID so the catch block can preserve it
  let resolvedGhlContactId: string | undefined;

  try {
    // ── 2. Upsert GHL contact ───────────────────────────────────────────────
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

    // ── 3. Save contact ID to DB immediately (before any later step fails) ──
    await db.golfClient.update({
      where: { id: client.id },
      data: {
        ghlContactId: resolvedGhlContactId,
        ghlLastSyncedAt: new Date(),
        ghlSyncStatus: "contact_resolved",
        ghlSyncError: null,
      },
    });

    // ── 4. Build club summary strings ───────────────────────────────────────
    const demoPairs = session.clubTests.filter((t) => t.clubRole === "demo");
    const currentPairs = session.clubTests.filter(
      (t) => t.clubRole === "current"
    );

    function clubLabel(test: (typeof demoPairs)[0]): string {
      const parts = [test.brand, test.model].filter(Boolean);
      return parts.length > 0 ? parts.join(" ") : test.clubType ?? "Unknown";
    }

    const recommendedClub = demoPairs.find((t) => t.isRecommended);
    const recommendedClubSummary = recommendedClub
      ? clubLabel(recommendedClub)
      : demoPairs.map(clubLabel).join(", ");

    const currentClubSummary =
      currentPairs.length > 0
        ? currentPairs.map(clubLabel).join(", ")
        : session.currentClub ?? "";

    const demoClubCount = demoPairs.length;

    // ── 5. Update GHL contact custom fields ─────────────────────────────────
    const customFields: { id: string; value: string }[] = [];

    const addField = (envKey: string, value: string | null | undefined) => {
      const fieldId = cf(envKey as keyof NodeJS.ProcessEnv);
      if (fieldId && value != null && value !== "") {
        customFields.push({ id: fieldId, value });
      }
    };

    addField("GHL_CF_SWING_LOCKER_URL", lockerUrl);
    addField("GHL_CF_LATEST_DEMO_SESSION_ID", String(session.id));
    addField(
      "GHL_CF_LATEST_DEMO_DATE",
      session.demoDate.toISOString().split("T")[0]
    );
    addField("GHL_CF_RECOMMENDED_CLUB_SUMMARY", recommendedClubSummary);
    addField("GHL_CF_CURRENT_CLUB_SUMMARY", currentClubSummary);
    addField("GHL_CF_DEMO_FOLLOWUP_STATUS", "pending");
    addField("GHL_CF_SALES_REP_NAME", session.salesRep ?? "");
    addField("GHL_CF_DEMO_CLUB_COUNT", String(demoClubCount));
    addField("GHL_CF_LAST_DEMO_SUBMITTED_AT", new Date().toISOString());

    let customFieldsUpdated = false;
    if (customFields.length > 0) {
      await updateContactCustomFields(resolvedGhlContactId, customFields);
      customFieldsUpdated = true;
    }

    // ── 6. Upsert opportunity ────────────────────────────────────────────────
    const oppName = `${client.firstName ?? ""} ${client.lastName ?? ""}`.trim();
    const ghlOpportunityId = await upsertGolfDemoOpportunity(
      {
        name: `${oppName} - Golf Demo`.trim(),
        contactId: resolvedGhlContactId,
      },
      session.ghlOpportunityId
    );

    // ── 7. Add tags to trigger GHL workflow ──────────────────────────────────
    const tagsAdded = ["golf-demo:locker-ready", "golf-demo:followup-active"];
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
          ...(resolvedGhlContactId
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
