import type { GhlOpportunity } from "@/lib/ghl/opportunities";
import type { CustomerResolutionState } from "./customer-resolution";
import type { GhlGateBatch, GhlGateClient } from "./ghl-approval-gate";
import { getOpportunityContactScope } from "./opportunity-contact";
import {
  isOpportunityResolutionMutable,
  type OpportunityResolutionState,
} from "./opportunity-resolution";
import {
  normalizeOpportunityCreatedAt,
  type OpportunityResolutionResponse,
} from "./opportunity-page";

// Opportunity selection for staged fittings. Existing opportunities are only
// listed and accepted for the GHL contact staff approved on the Customer step
// (ImportBatch.approvedGhlContactId); a saved GolfClient.ghlContactId is not
// consulted. All GHL access here is read-only.

export interface OpportunitySelectionBatch extends GhlGateBatch {
  id: number;
  parserMode: string;
  demoSessionId: number | null;
  opportunityResolution: string | null;
  selectedGhlOpportunityId: string | null;
  /** The selected GolfClient (existing customers only). */
  client: GhlGateClient | null;
}

export type OpportunityValidationResult =
  | { valid: true }
  | { valid: false; reason: "not_found" | "not_relevant" };

export interface OpportunitySelectionDeps {
  loadBatch(batchId: number): Promise<OpportunitySelectionBatch | null>;
  listOpen(contactId: string): Promise<GhlOpportunity[]>;
  validate(
    opportunityId: string,
    contactId: string,
  ): Promise<OpportunityValidationResult>;
  /**
   * Compare-and-set: succeeds only while the identity, opportunity and GHL
   * approval fields (and the GolfClient identity) still equal `expected`.
   */
  commit(
    expected: OpportunitySelectionBatch,
    state: OpportunityResolutionState,
  ): Promise<boolean>;
}

export type OpportunityFailure = {
  ok: false;
  status: 404 | 409 | 400 | 502;
  code: string;
  error: string;
};

const fail = (
  status: OpportunityFailure["status"],
  code: string,
  error: string,
): OpportunityFailure => ({ ok: false, status, code, error });

const APPROVAL_REQUIRED = fail(
  409,
  "ghl_approval_required",
  "Approve the GHL contact on the Customer step before choosing an opportunity.",
);

function customerState(batch: OpportunitySelectionBatch): CustomerResolutionState {
  return {
    customerResolution:
      batch.customerResolution === "existing" ||
      batch.customerResolution === "new"
        ? batch.customerResolution
        : null,
    selectedGolfClientId: batch.selectedGolfClientId,
    proposedFirstName: batch.proposedFirstName,
    proposedLastName: batch.proposedLastName,
    proposedEmail: batch.proposedEmail,
    proposedPhone: batch.proposedPhone,
  };
}

function stateOf(batch: OpportunitySelectionBatch): OpportunityResolutionState {
  return {
    opportunityResolution:
      batch.opportunityResolution === "existing" ||
      batch.opportunityResolution === "new"
        ? batch.opportunityResolution
        : null,
    selectedGhlOpportunityId: batch.selectedGhlOpportunityId,
  };
}

function isMutable(batch: OpportunitySelectionBatch): boolean {
  return isOpportunityResolutionMutable({
    ...customerState(batch),
    parserMode: batch.parserMode,
    demoSessionId: batch.demoSessionId,
  });
}

export async function getOpportunityOptions(
  deps: OpportunitySelectionDeps,
  batchId: number,
): Promise<
  | {
      ok: true;
      body: OpportunityResolutionResponse & {
        contactDecision: "existing" | "new" | null;
      };
    }
  | OpportunityFailure
> {
  const batch = await deps.loadBatch(batchId);
  if (!batch) return fail(404, "batch_not_found", "Import batch not found.");

  const mutable = isMutable(batch);
  const scope = getOpportunityContactScope(batch, batch.client);
  if (mutable && scope.kind === "approval_required") return APPROVAL_REQUIRED;

  const canSelectExisting = mutable && scope.kind === "existing";
  let opportunities: GhlOpportunity[] = [];
  if (canSelectExisting && scope.kind === "existing") {
    try {
      opportunities = await deps.listOpen(scope.contactId);
    } catch {
      return fail(
        502,
        "ghl_unavailable",
        "Could not load opportunities from GHL. Please try again.",
      );
    }
  }

  return {
    ok: true,
    body: {
      state: stateOf(batch),
      canModify: mutable,
      canSelectExisting,
      contactDecision:
        scope.kind === "existing" ? "existing" : scope.kind === "new" ? "new" : null,
      opportunities: opportunities.map((o) => ({
        id: o.id,
        name: o.name,
        pipelineStageId: o.pipelineStageId,
        status: o.status,
        createdAt: normalizeOpportunityCreatedAt(o.createdAt),
      })),
    },
  };
}

export async function saveOpportunitySelection(
  deps: OpportunitySelectionDeps,
  batchId: number,
  next: OpportunityResolutionState,
): Promise<{ ok: true; state: OpportunityResolutionState } | OpportunityFailure> {
  const batch = await deps.loadBatch(batchId);
  if (!batch) return fail(404, "batch_not_found", "Import batch not found.");

  if (!isMutable(batch)) {
    return fail(
      409,
      "not_mutable",
      "Opportunity resolution can only be changed for an unlinked TrackMan import with a resolved customer.",
    );
  }

  // Revalidated locally on every write: the stored approval must still match
  // the current customer identity.
  const scope = getOpportunityContactScope(batch, batch.client);
  if (scope.kind === "approval_required") return APPROVAL_REQUIRED;

  if (next.opportunityResolution === "existing") {
    if (scope.kind !== "existing") {
      return fail(
        409,
        "existing_opportunity_not_allowed",
        "A new GHL contact was approved for this fitting, so existing opportunities cannot be selected.",
      );
    }
    try {
      const validation = await deps.validate(
        next.selectedGhlOpportunityId!,
        scope.contactId,
      );
      if (!validation.valid) {
        return fail(
          400,
          validation.reason,
          validation.reason === "not_found"
            ? "The selected GHL opportunity was not found."
            : "The selected opportunity is not an open opportunity for the approved GHL contact in the Swing Locker pipeline.",
        );
      }
    } catch {
      return fail(
        502,
        "ghl_unavailable",
        "Could not validate the selected opportunity with GHL. Please try again.",
      );
    }
  }

  if (!(await deps.commit(batch, next))) {
    return fail(
      409,
      "state_changed",
      "Opportunity resolution changed concurrently. Reload and retry.",
    );
  }
  return { ok: true, state: next };
}
