import { hasPersistedCustomerResolution } from "./customer-workflow-routing";
import type {
  OpportunityResolution,
  OpportunityResolutionState,
} from "./opportunity-resolution";

export interface OpportunityOption {
  id: string;
  name: string;
  pipelineStageId: string | null;
  status: string | null;
  createdAt: string | null;
}

// Only a valid GHL createdAt is surfaced; anything else yields null.
export function normalizeOpportunityCreatedAt(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

export function formatOpportunityMeta(
  opportunity: Pick<OpportunityOption, "createdAt" | "status">,
): string {
  const status = opportunity.status ?? "open";
  if (!opportunity.createdAt) return status;
  const date = new Date(opportunity.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${date} · ${status}`;
}

export interface OpportunityResolutionResponse {
  state: OpportunityResolutionState;
  canModify: boolean;
  canSelectExisting: boolean;
  opportunities: OpportunityOption[];
}

export type OpportunityChoice =
  | { resolution: "existing"; selectedGhlOpportunityId: string }
  | { resolution: "new" }
  | { resolution: null };

interface OpportunityPageBatch {
  id: number;
  parserMode: string;
  demoSessionId: number | null;
  customerResolution: string | null;
  selectedGolfClientId: number | null;
  proposedFirstName: string | null;
  proposedLastName: string | null;
  proposedEmail: string | null;
  proposedPhone: string | null;
}

export function getOpportunityPageRedirect(
  batch: OpportunityPageBatch,
): string | null {
  if (batch.demoSessionId !== null) return `/staff/imports/${batch.id}/map`;
  if (batch.parserMode !== "trackman-result") return `/staff/imports/${batch.id}`;
  if (!hasPersistedCustomerResolution(batch)) {
    return `/staff/imports/${batch.id}/customer`;
  }
  return null;
}

export function getOpportunityChoiceBody(
  choice: OpportunityChoice,
): Record<string, unknown> {
  if (choice.resolution === "existing") {
    return {
      resolution: "existing",
      selectedGhlOpportunityId: choice.selectedGhlOpportunityId,
    };
  }
  return { resolution: choice.resolution };
}

export function isSameChoice(
  state: OpportunityResolutionState,
  choice: OpportunityChoice,
): boolean {
  if (state.opportunityResolution !== choice.resolution) return false;
  return (
    choice.resolution !== "existing" ||
    state.selectedGhlOpportunityId === choice.selectedGhlOpportunityId
  );
}

// A staged "existing" choice is only usable if it is still an open candidate.
export function isStagedSelectionAvailable(
  response: Pick<OpportunityResolutionResponse, "state" | "opportunities">,
): boolean {
  const { opportunityResolution, selectedGhlOpportunityId } = response.state;
  if (opportunityResolution !== "existing") return true;
  return response.opportunities.some(
    (opportunity) => opportunity.id === selectedGhlOpportunityId,
  );
}

export function canContinueFromOpportunity(
  response: Pick<OpportunityResolutionResponse, "state" | "opportunities">,
): boolean {
  const resolution: OpportunityResolution = response.state.opportunityResolution;
  if (resolution === null) return false;
  return isStagedSelectionAvailable(response);
}

export function getContinueHint(
  response: Pick<OpportunityResolutionResponse, "state" | "opportunities">,
): string | null {
  if (response.state.opportunityResolution === null) {
    return "Choose an opportunity or create a new one to continue.";
  }
  if (!isStagedSelectionAvailable(response)) {
    return "The previously selected opportunity is no longer open. Choose another option.";
  }
  return null;
}
