import { hasPersistedCustomerResolution } from "./customer-workflow-routing";
import {
  buildSuggestedOpportunityName,
  parseFittingDateOverride,
  parseOpportunityName,
} from "./opportunity-naming";
import type {
  OpportunityResolution,
  OpportunityResolutionState,
} from "./opportunity-resolution";

/** The part of the staged state the current UI reads. */
export type OpportunityChoiceState = Pick<
  OpportunityResolutionState,
  "opportunityResolution" | "selectedGhlOpportunityId"
>;

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
  state: OpportunityChoiceState;
  canModify: boolean;
  canSelectExisting: boolean;
  opportunities: OpportunityOption[];
}

/** Naming fields the GET adds for new opportunities (JSON-serialized dates). */
export interface OpportunityNamingInfo {
  fittingDate: string | null;
  fittingDateSource: "trackman" | "override" | null;
  suggestedOpportunityName: string | null;
  customerName: string;
  state: OpportunityChoiceState & {
    proposedOpportunityName: string | null;
    fittingDateOverride: string | null;
  };
}

export interface NamingDraft {
  name: string;
  /** YYYY-MM-DD, or "" while no date is known. */
  date: string;
}

export function suggestOpportunityNameFor(
  customerName: string,
  date: string,
): string | null {
  const parsed = parseFittingDateOverride(date);
  if (!parsed.ok) return null;
  return buildSuggestedOpportunityName({
    firstName: customerName,
    lastName: null,
    fittingDate: parsed.value,
  });
}

export function buildNamingDraft(
  info: Pick<
    OpportunityNamingInfo,
    "fittingDate" | "suggestedOpportunityName" | "state"
  >,
): NamingDraft {
  const date = info.fittingDate ? info.fittingDate.slice(0, 10) : "";
  const stored =
    info.state.opportunityResolution === "new"
      ? info.state.proposedOpportunityName
      : null;
  return { date, name: stored ?? info.suggestedOpportunityName ?? "" };
}

export function isNameCustomized(
  draft: NamingDraft,
  customerName: string,
): boolean {
  return draft.name !== (suggestOpportunityNameFor(customerName, draft.date) ?? "");
}

/** A changed date re-suggests the name unless staff have customized it. */
export function applyDateChange(
  draft: NamingDraft,
  customerName: string,
  date: string,
): NamingDraft {
  const customized = isNameCustomized(draft, customerName);
  return {
    date,
    name: customized ? draft.name : (suggestOpportunityNameFor(customerName, date) ?? ""),
  };
}

export function resetToSuggested(
  draft: NamingDraft,
  customerName: string,
): NamingDraft {
  return {
    ...draft,
    name: suggestOpportunityNameFor(customerName, draft.date) ?? "",
  };
}

export function validateNamingDraft(
  draft: NamingDraft,
  source: OpportunityNamingInfo["fittingDateSource"],
): string | null {
  if (source !== "trackman") {
    const date = parseFittingDateOverride(draft.date);
    if (!date.ok) return "Enter the fitting date.";
  }
  const name = parseOpportunityName(draft.name);
  return name.ok ? null : name.error;
}

/** Always sends the name explicitly so a customized name survives a date change. */
export function buildNewOpportunityBody(
  draft: NamingDraft,
  source: OpportunityNamingInfo["fittingDateSource"],
): Record<string, unknown> {
  return {
    resolution: "new",
    opportunityName: draft.name.trim(),
    ...(source === "trackman" ? {} : { fittingDate: draft.date }),
  };
}

export function isNamingSaved(
  draft: NamingDraft,
  info: Pick<OpportunityNamingInfo, "fittingDate" | "state">,
): boolean {
  if (info.state.opportunityResolution !== "new") return false;
  return (
    draft.name.trim() === (info.state.proposedOpportunityName ?? "") &&
    draft.date === (info.fittingDate ? info.fittingDate.slice(0, 10) : "")
  );
}

/** True when "Create New Opportunity" is chosen locally but not yet persisted. */
export function requiresNamingSave(
  newChosen: boolean,
  draft: NamingDraft,
  info: Pick<OpportunityNamingInfo, "fittingDate" | "state">,
): boolean {
  return newChosen && !isNamingSaved(draft, info);
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
  ghlDecision: "existing" | "new" | null,
): string | null {
  if (batch.demoSessionId !== null) return `/staff/imports/${batch.id}/map`;
  if (batch.parserMode !== "trackman-result") return `/staff/imports/${batch.id}`;
  if (!hasPersistedCustomerResolution(batch) || ghlDecision === null) {
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
  state: OpportunityChoiceState,
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
