import {
  buildLocalIdentity,
  evaluateApproval,
  getApprovalStatus,
  ghlDecisionChanged,
  hasCurrentGhlApproval,
  resolveBatchLocalIdentity,
  type ApprovalRequest,
  type GhlApprovalStatus,
  type GhlContactDecision,
  type GhlReviewSnapshot,
} from "@/lib/imports/ghl-contact-approval";
import {
  discoverContactForBatch,
  type BatchDiscoveryDeps,
} from "./discoverBatchContact";

// Persists (or clears) the staff decision on which GHL contact a staged
// fitting uses. Discovery is always recomputed here through the read-only GET
// lookups; this module never creates, updates or deletes GHL contacts and
// never writes GolfClient.ghlContactId.

export interface ApprovalBatchState {
  id: number;
  parserMode: string;
  demoSessionId: number | null;
  customerResolution: string | null;
  selectedGolfClientId: number | null;
  proposedFirstName: string | null;
  proposedLastName: string | null;
  proposedEmail: string | null;
  proposedPhone: string | null;
  opportunityResolution: string | null;
  selectedGhlOpportunityId: string | null;
  /** Local duplicate-review confirmation; part of the compare-and-set. */
  newCustomerConfirmationSignature: string | null;
  ghlContactDecision: string | null;
  approvedGhlContactId: string | null;
  ghlContactApprovalSignature: string | null;
  ghlContactApprovedAt: Date | null;
  ghlContactApprovedByStaffUserId: number | null;
  ghlContactReviewSnapshot: unknown;
}

export interface ApprovalWrite {
  decision: GhlContactDecision | null;
  approvedContactId: string | null;
  signature: string | null;
  approvedAt: Date | null;
  approvedByStaffUserId: number | null;
  snapshot: GhlReviewSnapshot | null;
  /** Reset opportunityResolution / selectedGhlOpportunityId in the same write. */
  clearOpportunity: boolean;
}

/** GolfClient values the approval was evaluated against (existing customers). */
export interface ApprovalClientGuard {
  ghlContactId: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}

export interface ApprovalDeps extends BatchDiscoveryDeps {
  loadApprovalBatch(batchId: number): Promise<ApprovalBatchState | null>;
  /**
   * One compare-and-set write: succeeds only if every field of `expected`
   * (and the GolfClient guard, when given) is unchanged. Returns false on a
   * concurrent change.
   */
  commitApproval(
    expected: ApprovalBatchState,
    clientGuard: ApprovalClientGuard | null,
    write: ApprovalWrite,
  ): Promise<boolean>;
  now(): Date;
}

export interface GhlApprovalView {
  status: GhlApprovalStatus;
  /** True when the stored approval is complete and matches the local identity. */
  current: boolean;
  decision: GhlContactDecision | null;
  approvedContactId: string | null;
  approvedAt: string | null;
  approvedByStaffUserId: number | null;
  acknowledgedDiscrepancies: string[];
  acknowledgedCandidateIds: string[];
  reviewedCandidateIds: string[];
}

export type ApprovalResult =
  | { ok: true; approval: GhlApprovalView; opportunityCleared: boolean }
  | {
      ok: false;
      httpStatus: 400 | 404 | 409;
      code: string;
      error: string;
      details?: Record<string, unknown>;
    };

const fail = (
  httpStatus: 400 | 404 | 409,
  code: string,
  error: string,
  details?: Record<string, unknown>,
): ApprovalResult => ({ ok: false, httpStatus, code, error, details });

function asSnapshot(value: unknown): Partial<GhlReviewSnapshot> | null {
  return typeof value === "object" && value !== null
    ? (value as Partial<GhlReviewSnapshot>)
    : null;
}

export function buildApprovalView(
  status: GhlApprovalStatus,
  fields: {
    decision: string | null;
    approvedContactId: string | null;
    approvedAt: Date | null;
    approvedByStaffUserId: number | null;
    snapshot: unknown;
  },
): GhlApprovalView {
  const current = hasCurrentGhlApproval(status);
  const snapshot = current ? asSnapshot(fields.snapshot) : null;
  return {
    status,
    current,
    decision:
      current && (fields.decision === "existing" || fields.decision === "new")
        ? fields.decision
        : null,
    approvedContactId: current ? fields.approvedContactId : null,
    approvedAt: current ? (fields.approvedAt?.toISOString() ?? null) : null,
    approvedByStaffUserId: current ? fields.approvedByStaffUserId : null,
    acknowledgedDiscrepancies: snapshot?.acknowledgedDiscrepancies ?? [],
    acknowledgedCandidateIds: snapshot?.acknowledgedCandidateIds ?? [],
    reviewedCandidateIds: (snapshot?.candidates ?? []).map((c) => c.id),
  };
}

function isStageable(batch: ApprovalBatchState): boolean {
  return batch.parserMode === "trackman-result" && batch.demoSessionId === null;
}

function storedOf(batch: ApprovalBatchState) {
  return {
    decision: batch.ghlContactDecision,
    approvedContactId: batch.approvedGhlContactId,
    signature: batch.ghlContactApprovalSignature,
    approvedAt: batch.ghlContactApprovedAt,
    approvedByStaffUserId: batch.ghlContactApprovedByStaffUserId,
    snapshot: batch.ghlContactReviewSnapshot,
  };
}

/** Local-only read of the persisted decision; makes no GHL request. */
export async function readGhlApproval(
  deps: ApprovalDeps,
  batchId: number,
): Promise<ApprovalResult> {
  const batch = await deps.loadApprovalBatch(batchId);
  if (!batch) return fail(404, "batch_not_found", "Import batch not found.");

  const client =
    batch.customerResolution === "existing" && batch.selectedGolfClientId !== null
      ? await deps.loadClient(batch.selectedGolfClientId)
      : null;
  const identity = resolveBatchLocalIdentity(batch, client);
  const status = getApprovalStatus(storedOf(batch), identity);
  return {
    ok: true,
    approval: buildApprovalView(status, storedOf(batch)),
    opportunityCleared: false,
  };
}

export async function updateGhlApproval(
  deps: ApprovalDeps,
  batchId: number,
  request: ApprovalRequest,
  staffUserId: number,
): Promise<ApprovalResult> {
  const batch = await deps.loadApprovalBatch(batchId);
  if (!batch) return fail(404, "batch_not_found", "Import batch not found.");
  if (!isStageable(batch)) {
    return fail(
      409,
      "not_stageable",
      "GHL contact approval is only available for unlinked TrackMan imports.",
    );
  }

  const previous = {
    decision: batch.ghlContactDecision,
    approvedContactId: batch.approvedGhlContactId,
  };
  const stateChanged = () =>
    fail(
      409,
      "state_changed",
      "This import changed while you were reviewing it. Reload and review again.",
    );

  if (request.action === "clear") {
    const write: ApprovalWrite = {
      decision: null,
      approvedContactId: null,
      signature: null,
      approvedAt: null,
      approvedByStaffUserId: null,
      snapshot: null,
      clearOpportunity: ghlDecisionChanged(previous, {
        decision: null,
        approvedContactId: null,
      }),
    };
    if (!(await deps.commitApproval(batch, null, write))) return stateChanged();
    return {
      ok: true,
      approval: buildApprovalView("unresolved", {
        decision: null,
        approvedContactId: null,
        approvedAt: null,
        approvedByStaffUserId: null,
        snapshot: null,
      }),
      opportunityCleared: write.clearOpportunity,
    };
  }

  const discovered = await discoverContactForBatch(deps, batchId);
  if (!discovered.ok) {
    return fail(discovered.httpStatus, discovered.code, discovered.error);
  }
  if (discovered.customer !== batch.customerResolution) return stateChanged();

  const identity = buildLocalIdentity({
    kind: discovered.customer,
    golfClientId: discovered.localCustomer.id,
    firstName: discovered.localCustomer.firstName,
    lastName: discovered.localCustomer.lastName,
    email: discovered.localCustomer.email,
    phone: discovered.localCustomer.phone,
  });

  const outcome = evaluateApproval({
    request,
    identity,
    discovery: discovered.discovery,
  });
  if (!outcome.ok) {
    return fail(outcome.httpStatus, outcome.code, outcome.error, outcome.details);
  }

  const approvedAt = deps.now();
  const write: ApprovalWrite = {
    decision: outcome.decision,
    approvedContactId: outcome.approvedContactId,
    signature: outcome.signature,
    approvedAt,
    approvedByStaffUserId: staffUserId,
    snapshot: outcome.snapshot,
    clearOpportunity: ghlDecisionChanged(previous, {
      decision: outcome.decision,
      approvedContactId: outcome.approvedContactId,
    }),
  };
  const clientGuard: ApprovalClientGuard | null =
    discovered.customer === "existing"
      ? {
          ghlContactId: discovered.persistedSavedContactId,
          firstName: discovered.localCustomer.firstName,
          lastName: discovered.localCustomer.lastName,
          email: discovered.localCustomer.email,
          phone: discovered.localCustomer.phone,
        }
      : null;

  if (!(await deps.commitApproval(batch, clientGuard, write))) {
    return stateChanged();
  }

  return {
    ok: true,
    approval: buildApprovalView(
      outcome.decision === "existing" ? "approved_existing" : "approved_new",
      {
        decision: outcome.decision,
        approvedContactId: outcome.approvedContactId,
        approvedAt,
        approvedByStaffUserId: staffUserId,
        snapshot: outcome.snapshot,
      },
    ),
    opportunityCleared: write.clearOpportunity,
  };
}
