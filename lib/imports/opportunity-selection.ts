import type { GhlOpportunity } from "@/lib/ghl/opportunities";
import type { CustomerResolutionState } from "./customer-resolution";
import type { GhlGateBatch, GhlGateClient } from "./ghl-approval-gate";
import { getOpportunityContactScope } from "./opportunity-contact";
import {
  buildSuggestedOpportunityName,
  resolveFittingDate,
} from "./opportunity-naming";
import {
  isOpportunityResolutionMutable,
  type OpportunityResolutionState,
} from "./opportunity-resolution";
import {
  normalizeOpportunityCreatedAt,
  type OpportunityResolutionResponse,
} from "./opportunity-page";

// Existing opportunities are scoped to the selected customer's saved contact.

export interface OpportunitySelectionBatch extends GhlGateBatch {
  id: number;
  parserMode: string;
  demoSessionId: number | null;
  opportunityResolution: string | null;
  selectedGhlOpportunityId: string | null;
  proposedOpportunityName: string | null;
  fittingDateOverride: Date | null;
  trackmanSessionDate: Date | null;
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
  "Select a customer before choosing an opportunity.",
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
    proposedOpportunityName: batch.proposedOpportunityName,
    fittingDateOverride: batch.fittingDateOverride,
  };
}

function customerDisplayName(batch: OpportunitySelectionBatch): string {
  const source = batch.client ?? {
    firstName: batch.proposedFirstName,
    lastName: batch.proposedLastName,
  };
  return `${source.firstName ?? ""} ${source.lastName ?? ""}`.trim();
}

function suggestedName(batch: OpportunitySelectionBatch, fittingDate: Date): string {
  const source = batch.client ?? {
    firstName: batch.proposedFirstName,
    lastName: batch.proposedLastName,
  };
  return buildSuggestedOpportunityName({
    firstName: source.firstName,
    lastName: source.lastName,
    fittingDate,
  });
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
      body: Omit<OpportunityResolutionResponse, "state"> & {
        state: OpportunityResolutionState;
        contactDecision: "existing" | "new" | null;
        fittingDate: string | null;
        fittingDateSource: "trackman" | "override" | null;
        suggestedOpportunityName: string | null;
        customerName: string;
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

  const fittingDate = resolveFittingDate(batch);
  return {
    ok: true,
    body: {
      state: stateOf(batch),
      canModify: mutable,
      canSelectExisting,
      fittingDate: fittingDate ? fittingDate.toISOString() : null,
      fittingDateSource: batch.trackmanSessionDate
        ? "trackman"
        : batch.fittingDateOverride
          ? "override"
          : null,
      suggestedOpportunityName: fittingDate ? suggestedName(batch, fittingDate) : null,
      customerName: customerDisplayName(batch),
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

/** A requested decision; naming fields are optional and default to "keep or suggest". */
export type OpportunitySelectionRequest = Pick<
  OpportunityResolutionState,
  "opportunityResolution" | "selectedGhlOpportunityId"
> &
  Partial<Pick<OpportunityResolutionState, "proposedOpportunityName" | "fittingDateOverride">>;

export async function saveOpportunitySelection(
  deps: OpportunitySelectionDeps,
  batchId: number,
  request: OpportunitySelectionRequest,
): Promise<{ ok: true; state: OpportunityResolutionState } | OpportunityFailure> {
  const next: OpportunityResolutionState = {
    opportunityResolution: request.opportunityResolution,
    selectedGhlOpportunityId: request.selectedGhlOpportunityId,
    proposedOpportunityName: request.proposedOpportunityName ?? null,
    fittingDateOverride: request.fittingDateOverride ?? null,
  };
  const batch = await deps.loadBatch(batchId);
  if (!batch) return fail(404, "batch_not_found", "Import batch not found.");

  if (!isMutable(batch)) {
    return fail(
      409,
      "not_mutable",
      "Opportunity resolution can only be changed for an unlinked TrackMan import with a resolved customer.",
    );
  }

  // Revalidate the selected customer's saved contact on every write.
  const scope = getOpportunityContactScope(batch, batch.client);
  if (scope.kind === "approval_required") return APPROVAL_REQUIRED;

  if (next.opportunityResolution === "existing") {
    if (scope.kind !== "existing") {
      return fail(
        409,
        "existing_opportunity_not_allowed",
        "Existing opportunities are unavailable until the customer has a saved GHL contact.",
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
            : "The selected opportunity is not an open opportunity for this customer's GHL contact in the Swing Locker pipeline.",
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

  let toCommit = next;
  if (next.opportunityResolution === "new") {
    if (batch.trackmanSessionDate && next.fittingDateOverride) {
      return fail(
        400,
        "fitting_date_not_allowed",
        "TrackMan supplied the fitting date, so it cannot be overridden.",
      );
    }
    const keep = batch.opportunityResolution === "new";
    const override = batch.trackmanSessionDate
      ? null
      : (next.fittingDateOverride ?? (keep ? batch.fittingDateOverride : null));
    const fittingDate = batch.trackmanSessionDate ?? override;
    if (!fittingDate) {
      return fail(
        400,
        "fitting_date_required",
        "The TrackMan file has no fitting date. Provide the fitting date to create a new opportunity.",
      );
    }
    // A stored name is kept only while the date it was built from is unchanged.
    const keptName =
      keep && !next.fittingDateOverride ? batch.proposedOpportunityName : null;
    toCommit = {
      ...next,
      fittingDateOverride: override,
      proposedOpportunityName:
        next.proposedOpportunityName ?? keptName ?? suggestedName(batch, fittingDate),
    };
  }

  if (!(await deps.commit(batch, toCommit))) {
    return fail(
      409,
      "state_changed",
      "Opportunity resolution changed concurrently. Reload and retry.",
    );
  }
  return { ok: true, state: toCommit };
}
