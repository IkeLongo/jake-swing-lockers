import { hasPersistedCustomerResolution } from "./customer-workflow-routing";
import { parseProposedIdentity } from "./customer-identifiers";
import {
  findDuplicateCandidates,
  type ClientIdentity,
} from "./new-customer-review";
import { computeReviewSignature } from "./new-customer-review-server";
import {
  flattenPlan,
  persistPlan,
  planComparisonGroups,
  type FinalizeStore,
  type PlannableSummary,
} from "./finalizationPlan";
import { hasGhlContactId } from "./opportunity-resolution";

// Local-only finalization of a staged TrackMan ImportBatch:
// ImportBatch -> GolfClient -> DemoSession -> DemoClubTest -> ClubTestMetrics.
// No GHL writes happen here. Concurrency relies on a row lock on the batch
// taken at the start of a single transaction, so there is no temporary
// "claimed" state that could be left behind by a failure.

export interface StagedFinalizeBatch {
  id: number;
  parserMode: string;
  status: string;
  demoSessionId: number | null;
  customerResolution: string | null;
  selectedGolfClientId: number | null;
  proposedFirstName: string | null;
  proposedLastName: string | null;
  proposedEmail: string | null;
  proposedPhone: string | null;
  newCustomerConfirmationSignature: string | null;
  opportunityResolution: string | null;
  selectedGhlOpportunityId: string | null;
  trackmanSessionDate: Date | null;
  selectedGolfClient: { id: number; ghlContactId: string | null } | null;
  demoSession: {
    id: number;
    status: string;
    clientId: number;
    ghlOpportunityId: string | null;
  } | null;
}

export interface NewDemoSessionInput {
  clientId: number;
  demoDate: Date;
  salesRep: string | null;
  ghlOpportunityId: string | null;
}

export interface StagedFinalizeTx<S extends PlannableSummary> {
  /** Must take an exclusive row lock on the ImportBatch (SELECT ... FOR UPDATE). */
  lockBatch(batchId: number): Promise<void>;
  loadBatch(batchId: number): Promise<StagedFinalizeBatch | null>;
  loadSummaries(batchId: number): Promise<S[]>;
  listClientsForDuplicateCheck(): Promise<ClientIdentity[]>;
  createClient(data: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  }): Promise<{ id: number }>;
  createFinalizedSession(data: NewDemoSessionInput): Promise<{ id: number }>;
  markBatchFinalized(batchId: number, demoSessionId: number): Promise<void>;
  clubStore: FinalizeStore<S>;
}

export type OpportunityValidation =
  | { valid: true }
  | { valid: false; reason: "not_found" | "not_relevant" };

export interface StagedFinalizeDeps<S extends PlannableSummary> {
  loadBatch(batchId: number): Promise<StagedFinalizeBatch | null>;
  loadSummaries(batchId: number): Promise<S[]>;
  /** Throws on GHL service failures so they are never mistaken for "not found". */
  validateOpportunity(
    opportunityId: string,
    ghlContactId: string,
  ): Promise<OpportunityValidation>;
  transaction<T>(fn: (tx: StagedFinalizeTx<S>) => Promise<T>): Promise<T>;
  now(): Date;
  /**
   * TEMPORARY (CP4c-A): blocks creating new staged finalizations until CP4d
   * enforces the persisted GHL contact decision. REMOVE IN CP4d together with
   * `cp4dFinalizationGuard`. Never applied to already-linked batches.
   */
  temporaryFinalizationGuard?: (batch: StagedFinalizeBatch) => Failure | null;
}

export type StagedFinalizeErrorCode =
  | "batch_not_found"
  | "not_eligible"
  | "already_linked"
  | "customer_unresolved"
  | "duplicate_customer_unresolved"
  | "opportunity_unresolved"
  | "invalid_opportunity_state"
  | "new_customer_existing_opportunity"
  | "no_ghl_contact"
  | "opportunity_no_longer_valid"
  | "no_clubs"
  | "ghl_unavailable"
  | "ghl_contact_integration_pending"
  | "state_changed";

export type StagedFinalizeResult =
  | {
      ok: true;
      alreadyFinalized: boolean;
      demoSessionId: number;
      golfClientId: number;
      opportunityResolution: "existing" | "new";
      ghlOpportunityId: string | null;
      clubCount: number | null;
    }
  | {
      ok: false;
      status: 400 | 404 | 409 | 502;
      code: StagedFinalizeErrorCode;
      error: string;
      retryable: boolean;
    };

type Failure = Extract<StagedFinalizeResult, { ok: false }>;

function fail(
  status: Failure["status"],
  code: StagedFinalizeErrorCode,
  error: string,
  retryable = false,
): Failure {
  return { ok: false, status, code, error, retryable };
}

function existingResult(
  batch: StagedFinalizeBatch,
): StagedFinalizeResult | Failure {
  const session = batch.demoSession;
  if (session && session.status === "finalized") {
    return {
      ok: true,
      alreadyFinalized: true,
      demoSessionId: session.id,
      golfClientId: session.clientId,
      opportunityResolution:
        batch.opportunityResolution === "existing" ? "existing" : "new",
      ghlOpportunityId: session.ghlOpportunityId,
      clubCount: null,
    };
  }
  return fail(
    409,
    "already_linked",
    "This import is already linked to a session that is not finalized. Finalize it from its session instead.",
  );
}

/**
 * TEMPORARY (CP4c-A → remove in CP4d). Finalization and CRM sync do not yet
 * honor the persisted GHL contact decision, so a new staged finalization is
 * refused. Legacy batches that already have a DemoSession return before this
 * guard is evaluated.
 */
export function cp4dFinalizationGuard(batch: StagedFinalizeBatch): Failure | null {
  if (batch.demoSessionId !== null) return null;
  return fail(
    409,
    "ghl_contact_integration_pending",
    "Finalizing staged fittings is temporarily disabled until GHL contact approval is fully integrated.",
  );
}

/** Pure validation of the staged state; GHL and club checks happen elsewhere. */
export function validateStagedBatch(batch: StagedFinalizeBatch): Failure | null {
  if (batch.parserMode !== "trackman-result" || batch.status === "failed") {
    return fail(409, "not_eligible", "This import is not eligible for staged finalization.");
  }
  if (batch.status === "finalized") {
    return fail(409, "not_eligible", "This import is marked finalized but has no linked session.");
  }
  if (!hasPersistedCustomerResolution(batch)) {
    return fail(409, "customer_unresolved", "Resolve the customer before finalizing.");
  }
  if (batch.customerResolution === "existing" && !batch.selectedGolfClient) {
    return fail(409, "customer_unresolved", "The selected customer no longer exists.");
  }
  if (
    batch.customerResolution === "new" &&
    !parseProposedIdentity({
      firstName: batch.proposedFirstName,
      lastName: batch.proposedLastName,
      email: batch.proposedEmail,
      phone: batch.proposedPhone,
    }).ok
  ) {
    return fail(
      409,
      "customer_unresolved",
      "The new customer needs a name and a valid email or phone. Update the customer details before finalizing.",
    );
  }

  const resolution = batch.opportunityResolution;
  const opportunityId = batch.selectedGhlOpportunityId;
  if (resolution === null) {
    if (opportunityId !== null) {
      return fail(409, "invalid_opportunity_state", "The staged opportunity decision is inconsistent.");
    }
    return fail(409, "opportunity_unresolved", "Choose an opportunity before finalizing.");
  }
  if (resolution === "new") {
    if (opportunityId !== null) {
      return fail(409, "invalid_opportunity_state", "A new opportunity cannot also reference an existing one.");
    }
    return null;
  }
  if (resolution === "existing") {
    if (!opportunityId || opportunityId.trim().length === 0) {
      return fail(409, "invalid_opportunity_state", "An existing opportunity must be selected.");
    }
    if (batch.customerResolution !== "existing") {
      return fail(
        409,
        "new_customer_existing_opportunity",
        "A new customer cannot be attached to an existing opportunity.",
      );
    }
    if (!hasGhlContactId(batch.selectedGolfClient?.ghlContactId)) {
      return fail(
        409,
        "no_ghl_contact",
        "This customer has no GHL contact, so an existing opportunity cannot be used.",
      );
    }
    return null;
  }
  return fail(409, "invalid_opportunity_state", "The staged opportunity decision is invalid.");
}

// Identity of everything the pre-transaction GHL validation depended on.
function stateSignature(batch: StagedFinalizeBatch): string {
  return JSON.stringify([
    batch.customerResolution,
    batch.selectedGolfClientId,
    batch.selectedGolfClient?.ghlContactId ?? null,
    batch.proposedFirstName,
    batch.proposedLastName,
    batch.proposedEmail,
    batch.proposedPhone,
    batch.newCustomerConfirmationSignature,
    batch.opportunityResolution,
    batch.selectedGhlOpportunityId,
  ]);
}

function planClubs<S extends PlannableSummary>(summaries: readonly S[]) {
  const rows = flattenPlan(planComparisonGroups(summaries));
  return {
    rows,
    clubCount: rows.filter((row) => row.clubRole === "demo").length,
  };
}

type ClientResolution =
  | { ok: true; clientId: number }
  | { ok: false; failure: Failure };

// Never reuses an existing customer. A new customer is created only when no
// GolfClient matches, or when staff confirmed this exact candidate set; the
// confirmation is recomputed here, inside the locked transaction.
async function resolveClientId<S extends PlannableSummary>(
  tx: StagedFinalizeTx<S>,
  batch: StagedFinalizeBatch,
): Promise<ClientResolution> {
  if (batch.customerResolution === "existing") {
    return { ok: true, clientId: batch.selectedGolfClient!.id };
  }

  const identity = parseProposedIdentity({
    firstName: batch.proposedFirstName,
    lastName: batch.proposedLastName,
    email: batch.proposedEmail,
    phone: batch.proposedPhone,
  });
  if (!identity.ok) {
    return {
      ok: false,
      failure: fail(409, "customer_unresolved", identity.error),
    };
  }
  const { firstName, lastName, email, phone } = identity.value;

  const candidates = findDuplicateCandidates(
    await tx.listClientsForDuplicateCheck(),
    { email, phone },
  );
  if (
    candidates.length > 0 &&
    (batch.newCustomerConfirmationSignature === null ||
      batch.newCustomerConfirmationSignature !==
        computeReviewSignature({ email, phone }, candidates))
  ) {
    return {
      ok: false,
      failure: fail(
        409,
        "duplicate_customer_unresolved",
        "An existing customer matches this new customer's email or phone, and the match has not been reviewed. Review the customer step before finalizing.",
      ),
    };
  }

  const created = await tx.createClient({ firstName, lastName, email, phone });
  return { ok: true, clientId: created.id };
}

export async function finalizeStagedImport<S extends PlannableSummary>(
  deps: StagedFinalizeDeps<S>,
  input: { batchId: number; salesRep: string | null },
): Promise<StagedFinalizeResult> {
  const { batchId, salesRep } = input;

  // ── Pre-checks (no locks, no writes) ───────────────────────────────────────
  const batch = await deps.loadBatch(batchId);
  if (!batch) return fail(404, "batch_not_found", "Import batch not found.");
  if (batch.demoSessionId !== null) return existingResult(batch);

  const blocked = deps.temporaryFinalizationGuard?.(batch);
  if (blocked) return blocked;

  const invalid = validateStagedBatch(batch);
  if (invalid) return invalid;

  if (planClubs(await deps.loadSummaries(batchId)).clubCount === 0) {
    return fail(
      400,
      "no_clubs",
      "No clubs are included in the report. Include at least one club before finalizing.",
    );
  }

  // GHL is checked outside the transaction so a slow API never holds the lock.
  if (batch.opportunityResolution === "existing") {
    try {
      const validation = await deps.validateOpportunity(
        batch.selectedGhlOpportunityId!,
        batch.selectedGolfClient!.ghlContactId!,
      );
      if (!validation.valid) {
        return fail(
          409,
          "opportunity_no_longer_valid",
          validation.reason === "not_found"
            ? "The selected opportunity no longer exists. Choose another opportunity."
            : "The selected opportunity is no longer an open opportunity for this customer. Choose another opportunity.",
        );
      }
    } catch {
      return fail(
        502,
        "ghl_unavailable",
        "Could not verify the selected opportunity with GHL. Please try again.",
        true,
      );
    }
  }
  const expectedSignature = stateSignature(batch);

  // ── Single transaction: lock, re-check, write ──────────────────────────────
  return deps.transaction(async (tx): Promise<StagedFinalizeResult> => {
    await tx.lockBatch(batchId);

    const locked = await tx.loadBatch(batchId);
    if (!locked) return fail(404, "batch_not_found", "Import batch not found.");
    if (locked.demoSessionId !== null) return existingResult(locked);

    const lockedBlocked = deps.temporaryFinalizationGuard?.(locked);
    if (lockedBlocked) return lockedBlocked;

    const lockedInvalid = validateStagedBatch(locked);
    if (lockedInvalid) return lockedInvalid;
    if (stateSignature(locked) !== expectedSignature) {
      return fail(
        409,
        "state_changed",
        "The staged fitting changed while finalizing. Review it and try again.",
        true,
      );
    }

    const { rows, clubCount } = planClubs(await tx.loadSummaries(batchId));
    if (clubCount === 0) {
      return fail(
        400,
        "no_clubs",
        "No clubs are included in the report. Include at least one club before finalizing.",
      );
    }

    const resolvedClient = await resolveClientId(tx, locked);
    if (!resolvedClient.ok) return resolvedClient.failure;
    const clientId = resolvedClient.clientId;
    const ghlOpportunityId =
      locked.opportunityResolution === "existing"
        ? locked.selectedGhlOpportunityId
        : null;

    const session = await tx.createFinalizedSession({
      clientId,
      demoDate: locked.trackmanSessionDate ?? deps.now(),
      salesRep,
      ghlOpportunityId,
    });
    await persistPlan(tx.clubStore, session.id, rows);
    await tx.markBatchFinalized(batchId, session.id);

    return {
      ok: true,
      alreadyFinalized: false,
      demoSessionId: session.id,
      golfClientId: clientId,
      opportunityResolution:
        locked.opportunityResolution === "existing" ? "existing" : "new",
      ghlOpportunityId,
      clubCount,
    };
  });
}
