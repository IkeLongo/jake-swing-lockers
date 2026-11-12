import {
  GOLF_DEMO_TAGS,
  buildGolfDemoCustomFields,
  buildGolfDemoSummaries,
  golfDemoOpportunityName,
  type SyncClubTest,
} from "./golfDemoSyncContent";
import { ContactNeedsReviewError } from "./resolveStagedContact";
import { getBatchGhlApprovalStatus, getCurrentGhlDecision } from "@/lib/imports/ghl-approval-gate";
import { isDefiniteGhlNoMutation } from "./client";
import { FITTING_RECONCILIATION_MESSAGE, hasUnresolvedCustomerCreation, hasUnresolvedFittingSyncState } from "./syncErrorMarker";

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
  ghlContactCreationState?: unknown;
  syncState?: {
    desiredVersion: number;
    creationAttemptId?: string | null;
    creationAttemptVersion?: number | null;
    creationAttemptStatus?: string | null;
    creationAttemptedAt?: Date | null;
  } | null;
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
  ghlSyncState: unknown;
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
  /** NULL for batches staged before opportunity naming existed. */
  proposedOpportunityName?: string | null;
  customerResolution: string | null;
  selectedGolfClientId: number | null;
  proposedFirstName: string | null;
  proposedLastName: string | null;
  proposedEmail: string | null;
  proposedPhone: string | null;
  ghlContactDecision: string | null;
  approvedGhlContactId: string | null;
  ghlContactApprovalSignature: string | null;
  ghlContactReviewSnapshot: unknown;
  demoSession: StagedSyncSession | null;
}

export interface StagedSyncState {
  version: 1;
  fittingClaim?: { token: string; claimedAt: string };
  contact?:
    | {
        status: "creating";
        batchId: number;
        clientId: number;
        attemptedAt: string;
      }
    | {
        status: "resolved";
        batchId: number;
        clientId: number;
        contactId: string;
      };
  opportunity?: {
    status: "creating";
    batchId: number;
    contactId: string;
    attemptedAt: string;
  };
}

export type SyncOpportunityValidation =
  | { valid: true }
  | { valid: false; reason: "not_found" | "not_relevant" };

export interface StagedSyncDeps {
  loadBatch(batchId: number): Promise<StagedSyncBatch | null>;
  verifyApprovedContact(contactId: string, clientId: number): Promise<void>;
  resolveNewContact(
    input: Pick<StagedSyncClient, "firstName" | "lastName" | "email" | "phone">,
    args: {
      sessionId: number;
      batchId: number;
      clientId: number;
      savedGhlContactId: string | null;
      expectedVersion?: number | null;
    },
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
  ensureOpportunityId(
    sessionId: number,
    batchId: number,
    contactId: string,
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
    retryable: boolean;
  }): Promise<void>;
  now(): Date;
  appBaseUrl(): string;
}

export type StagedSyncPreconditionCode =
  | "batch_not_found"
  | "not_eligible"
  | "not_finalized"
  | "no_session"
  | "load_failed"
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
      code?: "contact-needs-review" | "creation-needs-reconciliation" | "sync-needs-reconciliation";
      error: string;
    }
  | {
      ok: false;
      status: "rejected";
      httpStatus: 404 | 409 | 503;
      code: StagedSyncPreconditionCode;
      error: string;
    };

function rejected(
  httpStatus: 404 | 409 | 503,
  code: StagedSyncPreconditionCode,
  error: string,
): StagedSyncResult {
  return { ok: false, status: "rejected", httpStatus, code, error };
}

class NonRetryableSyncError extends Error {}

export class CreationNeedsReconciliationError extends Error {
  readonly code = "creation-needs-reconciliation" as const;
  constructor(message: string) {
    super(message);
    this.name = "CreationNeedsReconciliationError";
  }
}

class SyncNeedsReconciliationError extends Error {}

async function guardedMutation<T>(mutate: () => Promise<T>): Promise<T> {
  try {
    return await mutate();
  } catch (error) {
    if (isDefiniteGhlNoMutation(error)) throw error;
    throw new SyncNeedsReconciliationError(FITTING_RECONCILIATION_MESSAGE, { cause: error });
  }
}

export async function syncStagedFittingToGHL(
  deps: StagedSyncDeps,
  batchId: number,
): Promise<StagedSyncResult> {
  let batch;
  try {
    batch = await deps.loadBatch(batchId);
  } catch (error) {
    console.error("[syncStagedFittingToGHL] Could not load the fitting:", error);
    return rejected(503, "load_failed", "Could not load the fitting for CRM sync. Try again.");
  }
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
  // The caller's own claim is expected here; creation markers are not.
  const state = session.ghlSyncState;
  if (state && typeof state === "object" && !Array.isArray(state)) {
    const remaining = { ...state } as Record<string, unknown>;
    delete remaining.fittingClaim;
    if (hasUnresolvedFittingSyncState(remaining)) {
      return { ok: false, status: "failed", demoSessionId: session.id, retryable: false,
        code: "creation-needs-reconciliation", error: FITTING_RECONCILIATION_MESSAGE };
    }
  } else if (hasUnresolvedFittingSyncState(state)) {
    return { ok: false, status: "failed", demoSessionId: session.id, retryable: false,
      code: "creation-needs-reconciliation", error: FITTING_RECONCILIATION_MESSAGE };
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
  if (hasUnresolvedCustomerCreation(client)) {
    return { ok: false, status: "failed", demoSessionId: session.id, retryable: false,
      code: "creation-needs-reconciliation", error: FITTING_RECONCILIATION_MESSAGE };
  }
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

  let ghlContactId: string | null = null;
  try {
    const approvalStatus = getBatchGhlApprovalStatus(batch, client);
    const contactDecision = getCurrentGhlDecision(batch, client);
    if (
      !contactDecision ||
      (contactDecision === "new" && resolution !== "new") ||
      (batch.customerResolution === "existing" &&
        batch.selectedGolfClientId !== client.id) ||
      (batch.customerResolution === "new" && batch.selectedGolfClientId !== null)
    ) {
      throw new ContactNeedsReviewError(
        "identity_conflict",
        approvalStatus === "stale"
          ? "The GHL contact approval is stale. Review and approve it again before syncing."
          : "A current GHL contact approval for this finalized customer is required before syncing.",
      );
    }

    // 1. Resolve exactly the staff-approved identity before syncing the fitting.
    if (contactDecision === "existing") {
      const approvedContactId = batch.approvedGhlContactId!;
      if (client.ghlContactId && client.ghlContactId !== approvedContactId) {
        throw new ContactNeedsReviewError(
          "identity_conflict",
          "The local customer is linked to a different GHL contact than the one approved for this fitting.",
        );
      }
      await deps.verifyApprovedContact(approvedContactId, client.id);
      if (!client.ghlContactId) {
        await deps.saveContactId(client.id, approvedContactId);
      }
      ghlContactId = approvedContactId;
    } else {
      const identity =
        batch.customerResolution === "existing"
          ? {
              firstName: client.firstName,
              lastName: client.lastName,
              email: client.email,
              phone: client.phone,
            }
          : {
              firstName: batch.proposedFirstName,
              lastName: batch.proposedLastName,
              email: batch.proposedEmail,
              phone: batch.proposedPhone,
            };
      const resolved = await deps.resolveNewContact(
        identity,
        {
          sessionId: session.id,
          batchId: batch.id,
          clientId: client.id,
          savedGhlContactId: client.ghlContactId,
          expectedVersion: client.syncState?.desiredVersion ?? null,
        },
      );
      ghlContactId = resolved.id;
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
      ghlOpportunityId = await deps.ensureOpportunityId(
        session.id,
        batch.id,
        ghlContactId,
        () =>
        deps.createOpportunity({
          name: batch.proposedOpportunityName?.trim() || golfDemoOpportunityName(client),
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
      await guardedMutation(() => deps.updateContactCustomFields(ghlContactId!, fields));
    }

    // 4. Workflow tags, once; the marker is saved before any later work.
    if (!session.ghlLockerReadyTagAddedAt) {
      await guardedMutation(() => deps.addTags(ghlContactId!, [...GOLF_DEMO_TAGS]));
      try {
        await deps.markTagsAdded(session.id, lockerUrl);
      } catch (error) {
        throw new SyncNeedsReconciliationError(FITTING_RECONCILIATION_MESSAGE, { cause: error });
      }
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
    const retryable = !(
      err instanceof NonRetryableSyncError ||
      err instanceof ContactNeedsReviewError ||
      err instanceof CreationNeedsReconciliationError ||
      err instanceof SyncNeedsReconciliationError
    );
    if (!(err instanceof CreationNeedsReconciliationError)) {
      try {
        await deps.markFailed({
          sessionId: session.id,
          clientId: client.id,
          ghlContactId,
          message,
          retryable,
        });
      } catch {
        // Recording the failure is best-effort.
      }
    }
    return {
      ok: false,
      status: "failed",
      demoSessionId: session.id,
      retryable,
      ...(err instanceof ContactNeedsReviewError ? { code: err.code } : {}),
      ...(err instanceof CreationNeedsReconciliationError
        ? { code: err.code }
        : {}),
      ...(err instanceof SyncNeedsReconciliationError
        ? { code: "sync-needs-reconciliation" as const }
        : {}),
      error: message,
    };
  }
}
