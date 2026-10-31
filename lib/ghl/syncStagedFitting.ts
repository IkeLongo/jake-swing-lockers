import {
  GOLF_DEMO_TAGS,
  buildGolfDemoCustomFields,
  buildGolfDemoSummaries,
  golfDemoOpportunityName,
  type SyncClubTest,
} from "./golfDemoSyncContent";

// CRM sync for a locally finalized, staged TrackMan fitting.
//
// The ImportBatch is the root: it says whether this fitting belongs to an
// existing opportunity or needs a new one. Nothing here changes local fitting
// data (session, clubs, metrics); a CRM failure is only recorded as sync state.
// Each step persists its result before the next one so retries resume safely.

export interface StagedSyncClient {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  ghlContactId: string | null;
}

export interface StagedSyncSession {
  id: number;
  status: string;
  lockerToken: string;
  demoDate: Date;
  salesRep: string | null;
  currentClub: string | null;
  ghlOpportunityId: string | null;
  ghlSyncStatus: string | null;
  ghlLockerReadyTagAddedAt: Date | null;
  clubTests: SyncClubTest[];
  client: StagedSyncClient;
}

export interface StagedSyncBatch {
  id: number;
  parserMode: string;
  status: string;
  opportunityResolution: string | null;
  selectedGhlOpportunityId: string | null;
  demoSession: StagedSyncSession | null;
}

export type SyncOpportunityValidation =
  | { valid: true }
  | { valid: false; reason: "not_found" | "not_relevant" };

export interface StagedSyncDeps {
  loadBatch(batchId: number): Promise<StagedSyncBatch | null>;
  upsertContact(
    input: Pick<StagedSyncClient, "firstName" | "lastName" | "email" | "phone">,
    existingGhlContactId: string | null,
  ): Promise<{ id: string }>;
  saveContactId(clientId: number, ghlContactId: string): Promise<void>;
  /** Read-only. Throws on GHL service failures. */
  validateOpportunity(
    opportunityId: string,
    ghlContactId: string,
  ): Promise<SyncOpportunityValidation>;
  createOpportunity(input: {
    name: string;
    contactId: string;
    monetaryValue?: number;
  }): Promise<string>;
  /**
   * The only critical section: under an exclusive lock on the session, read
   * ghlOpportunityId; if null, run `create` and persist the returned ID before
   * releasing. Returns the stored (or newly created) opportunity ID.
   */
  ensureOpportunityId(
    sessionId: number,
    create: () => Promise<string>,
  ): Promise<string>;
  updateContactCustomFields(
    ghlContactId: string,
    fields: { id: string; value: string }[],
  ): Promise<void>;
  addTags(ghlContactId: string, tags: string[]): Promise<void>;
  markTagsAdded(sessionId: number, lockerUrl: string): Promise<void>;
  markSynced(args: {
    sessionId: number;
    clientId: number;
    ghlContactId: string;
    ghlOpportunityId: string;
    lockerUrl: string;
  }): Promise<void>;
  markFailed(args: {
    sessionId: number;
    clientId: number;
    ghlContactId: string | null;
    message: string;
  }): Promise<void>;
  now(): Date;
  appBaseUrl(): string;
}

export type StagedSyncPreconditionCode =
  | "batch_not_found"
  | "not_eligible"
  | "not_finalized"
  | "no_session"
  | "invalid_opportunity_state";

export type StagedSyncResult =
  | {
      ok: true;
      status: "synced";
      alreadySynced: boolean;
      demoSessionId: number;
      ghlContactId: string;
      ghlOpportunityId: string;
    }
  | {
      ok: false;
      status: "failed";
      demoSessionId: number;
      retryable: boolean;
      error: string;
    }
  | {
      ok: false;
      status: "rejected";
      httpStatus: 404 | 409;
      code: StagedSyncPreconditionCode;
      error: string;
    };

function rejected(
  httpStatus: 404 | 409,
  code: StagedSyncPreconditionCode,
  error: string,
): StagedSyncResult {
  return { ok: false, status: "rejected", httpStatus, code, error };
}

class NonRetryableSyncError extends Error {}

export async function syncStagedFittingToGHL(
  deps: StagedSyncDeps,
  batchId: number,
): Promise<StagedSyncResult> {
  const batch = await deps.loadBatch(batchId);
  if (!batch) return rejected(404, "batch_not_found", "Import batch not found.");
  if (batch.parserMode !== "trackman-result") {
    return rejected(409, "not_eligible", "This import is not a staged TrackMan fitting.");
  }
  if (batch.status !== "finalized") {
    return rejected(409, "not_finalized", "Finalize the fitting before syncing to the CRM.");
  }
  const session = batch.demoSession;
  if (!session || session.status !== "finalized") {
    return rejected(409, "no_session", "This import has no finalized fitting session.");
  }

  const resolution = batch.opportunityResolution;
  if (resolution === "existing") {
    if (
      !batch.selectedGhlOpportunityId ||
      session.ghlOpportunityId !== batch.selectedGhlOpportunityId
    ) {
      return rejected(
        409,
        "invalid_opportunity_state",
        "The fitting is not attached to the staged opportunity.",
      );
    }
  } else if (resolution === "new") {
    if (batch.selectedGhlOpportunityId !== null) {
      return rejected(
        409,
        "invalid_opportunity_state",
        "A new opportunity cannot also reference an existing one.",
      );
    }
  } else {
    return rejected(
      409,
      "invalid_opportunity_state",
      "The opportunity decision was not staged.",
    );
  }

  const client = session.client;
  if (
    session.ghlSyncStatus === "synced" &&
    session.ghlOpportunityId &&
    session.ghlLockerReadyTagAddedAt &&
    client.ghlContactId
  ) {
    return {
      ok: true,
      status: "synced",
      alreadySynced: true,
      demoSessionId: session.id,
      ghlContactId: client.ghlContactId,
      ghlOpportunityId: session.ghlOpportunityId,
    };
  }

  let ghlContactId: string | null = client.ghlContactId;
  try {
    // 1. Contact: reuse a saved ID; otherwise resolve and persist immediately.
    if (!ghlContactId) {
      const resolved = await deps.upsertContact(client, null);
      ghlContactId = resolved.id;
      await deps.saveContactId(client.id, ghlContactId);
    }

    const summaries = buildGolfDemoSummaries(session);
    const lockerUrl = `${deps.appBaseUrl()}/swing-locker/${session.lockerToken}`;

    // 2. Opportunity.
    let ghlOpportunityId: string;
    if (resolution === "existing") {
      // Read-only: an attached opportunity is never renamed, restaged or re-valued.
      const validation = await deps.validateOpportunity(
        session.ghlOpportunityId!,
        ghlContactId,
      );
      if (!validation.valid) {
        throw new NonRetryableSyncError(
          validation.reason === "not_found"
            ? "The attached GHL opportunity no longer exists."
            : "The attached GHL opportunity is no longer an open opportunity for this customer.",
        );
      }
      ghlOpportunityId = session.ghlOpportunityId!;
    } else {
      const contactId = ghlContactId;
      ghlOpportunityId = await deps.ensureOpportunityId(session.id, () =>
        deps.createOpportunity({
          name: golfDemoOpportunityName(client),
          contactId,
          monetaryValue: summaries.monetaryValue,
        }),
      );
    }

    // 3. Contact custom fields (idempotent).
    const fields = buildGolfDemoCustomFields(
      session,
      summaries,
      lockerUrl,
      deps.now().toISOString(),
    );
    if (fields.length > 0) {
      await deps.updateContactCustomFields(ghlContactId, fields);
    }

    // 4. Workflow tags, once; the marker is saved before any later work.
    if (!session.ghlLockerReadyTagAddedAt) {
      await deps.addTags(ghlContactId, [...GOLF_DEMO_TAGS]);
      await deps.markTagsAdded(session.id, lockerUrl);
    }

    // 5. Final status + event log.
    await deps.markSynced({
      sessionId: session.id,
      clientId: client.id,
      ghlContactId,
      ghlOpportunityId,
      lockerUrl,
    });

    return {
      ok: true,
      status: "synced",
      alreadySynced: false,
      demoSessionId: session.id,
      ghlContactId,
      ghlOpportunityId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await deps.markFailed({
        sessionId: session.id,
        clientId: client.id,
        ghlContactId,
        message,
      });
    } catch {
      // Recording the failure is best-effort.
    }
    return {
      ok: false,
      status: "failed",
      demoSessionId: session.id,
      retryable: !(err instanceof NonRetryableSyncError),
      error: message,
    };
  }
}
