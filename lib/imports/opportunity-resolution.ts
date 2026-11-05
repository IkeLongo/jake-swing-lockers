import {
  hasSameCustomerIdentity,
  type CustomerResolutionState,
} from "./customer-resolution";
import { hasPersistedCustomerResolution } from "./customer-workflow-routing";
import { parseFittingDateOverride, parseOpportunityName } from "./opportunity-naming";

export type OpportunityResolution = "existing" | "new" | null;

export interface OpportunityResolutionState {
  opportunityResolution: OpportunityResolution;
  selectedGhlOpportunityId: string | null;
  /** New opportunities only; NULL in a request means "keep or suggest". */
  proposedOpportunityName: string | null;
  /** Only when TrackMan supplied no date; NULL in a request means "keep". */
  fittingDateOverride: Date | null;
}

export type OpportunityResolutionParseResult =
  | { success: true; state: OpportunityResolutionState }
  | { success: false; error: string };

export interface OpportunityResolutionBatch
  extends CustomerResolutionState {
  parserMode: string;
  demoSessionId: number | null;
}

const EMPTY_STATE: OpportunityResolutionState = {
  opportunityResolution: null,
  selectedGhlOpportunityId: null,
  proposedOpportunityName: null,
  fittingDateOverride: null,
};

export function getOpportunityStateAfterCustomerChange(
  currentCustomer: CustomerResolutionState,
  nextCustomer: CustomerResolutionState,
  currentOpportunity: OpportunityResolutionState,
): OpportunityResolutionState {
  return hasSameCustomerIdentity(currentCustomer, nextCustomer)
    ? currentOpportunity
    : { ...EMPTY_STATE };
}

export function parseOpportunityResolution(
  input: unknown,
): OpportunityResolutionParseResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { success: false, error: "Request body must be an object." };
  }

  const body = input as Record<string, unknown>;
  const resolution = body.resolution;
  const selectedGhlOpportunityId = body.selectedGhlOpportunityId;
  const hasNaming = (key: string) =>
    body[key] !== undefined && body[key] !== null;

  if (resolution !== "new" && (hasNaming("opportunityName") || hasNaming("fittingDate"))) {
    return {
      success: false,
      error: "opportunityName and fittingDate apply only to a new opportunity.",
    };
  }
  if (resolution === null) {
    if (
      selectedGhlOpportunityId !== undefined &&
      selectedGhlOpportunityId !== null
    ) {
      return {
        success: false,
        error: "An unresolved opportunity decision cannot include an opportunity ID.",
      };
    }
    return { success: true, state: { ...EMPTY_STATE } };
  }

  if (resolution === "new") {
    if (
      selectedGhlOpportunityId !== undefined &&
      selectedGhlOpportunityId !== null
    ) {
      return {
        success: false,
        error: "A new-opportunity decision cannot include an opportunity ID.",
      };
    }
    let proposedOpportunityName: string | null = null;
    if (hasNaming("opportunityName")) {
      const name = parseOpportunityName(body.opportunityName);
      if (!name.ok) return { success: false, error: name.error };
      proposedOpportunityName = name.value;
    }
    let fittingDateOverride: Date | null = null;
    if (hasNaming("fittingDate")) {
      const date = parseFittingDateOverride(body.fittingDate);
      if (!date.ok) return { success: false, error: date.error };
      fittingDateOverride = date.value;
    }
    return {
      success: true,
      state: {
        opportunityResolution: "new",
        selectedGhlOpportunityId: null,
        proposedOpportunityName,
        fittingDateOverride,
      },
    };
  }

  if (resolution === "existing") {
    if (
      typeof selectedGhlOpportunityId !== "string" ||
      selectedGhlOpportunityId.trim().length === 0
    ) {
      return {
        success: false,
        error:
          "A selectedGhlOpportunityId is required for an existing opportunity.",
      };
    }
    return {
      success: true,
      state: {
        opportunityResolution: "existing",
        selectedGhlOpportunityId: selectedGhlOpportunityId.trim(),
        proposedOpportunityName: null,
        fittingDateOverride: null,
      },
    };
  }

  return {
    success: false,
    error: 'resolution must be "existing", "new", or null.',
  };
}

export function isOpportunityResolutionMutable(
  batch: OpportunityResolutionBatch,
): boolean {
  return (
    batch.parserMode === "trackman-result" &&
    batch.demoSessionId === null &&
    hasPersistedCustomerResolution(batch)
  );
}

export function hasGhlContactId(
  ghlContactId: string | null | undefined,
): ghlContactId is string {
  return typeof ghlContactId === "string" && ghlContactId.trim().length > 0;
}
