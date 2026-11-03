import { decodeSyncError } from "@/lib/ghl/syncErrorMarker";
import { hasPersistedCustomerResolution } from "./customer-workflow-routing";
import {
  flattenPlan,
  planComparisonGroups,
  type PlannableSummary,
} from "./finalizationPlan";

// ── Page state ───────────────────────────────────────────────────────────────

export interface ConfirmBatch {
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
  opportunityResolution: string | null;
  selectedGhlOpportunityId: string | null;
  demoSession: {
    status: string;
    ghlSyncStatus: string | null;
    ghlSyncError?: string | null;
  } | null;
}

export type ConfirmStage = "ready" | "synced" | "crm_pending" | "crm_action_required";

export interface ConfirmPageState {
  stage: ConfirmStage;
  /** true when a CRM sync was attempted and failed; false when never attempted. */
  syncAttempted: boolean;
  /** Last recorded CRM error, without the internal marker. */
  error: string | null;
}

// Where an ineligible batch belongs in the workflow; null means the Confirm
// page can render (either ready to finalize or already finalized).
export function getConfirmPageRedirect(
  batch: ConfirmBatch,
  includedClubCount: number,
  ghlDecision: "existing" | "new" | null,
): string | null {
  const base = `/staff/imports/${batch.id}`;
  if (batch.parserMode !== "trackman-result" || batch.status === "failed") {
    return base;
  }
  if (batch.demoSessionId !== null) {
    // Linked to a legacy / unfinalized session: not a staged confirmation.
    return batch.demoSession?.status === "finalized" ? null : `${base}/map`;
  }
  if (batch.status === "finalized") return `${base}/map`;
  if (!hasPersistedCustomerResolution(batch) || ghlDecision === null) {
    return `${base}/customer`;
  }

  const { opportunityResolution: resolution, selectedGhlOpportunityId: id } =
    batch;
  // A "new" contact has no existing opportunities to select.
  const opportunityComplete =
    (resolution === "new" && id === null) ||
    (resolution === "existing" &&
      ghlDecision === "existing" &&
      !!id &&
      id.trim().length > 0);
  if (!opportunityComplete) return `${base}/opportunity`;

  if (includedClubCount === 0) return `${base}/map`;
  return null;
}

export function getConfirmPageState(batch: ConfirmBatch): ConfirmPageState {
  const session = batch.demoSession;
  if (batch.demoSessionId === null || session?.status !== "finalized") {
    return { stage: "ready", syncAttempted: false, error: null };
  }
  if (session.ghlSyncStatus === "synced") {
    return { stage: "synced", syncAttempted: true, error: null };
  }
  if (session.ghlSyncStatus === "failed") {
    const { message, actionRequired } = decodeSyncError(session.ghlSyncError);
    return {
      stage: actionRequired ? "crm_action_required" : "crm_pending",
      syncAttempted: true,
      error: message,
    };
  }
  return { stage: "crm_pending", syncAttempted: false, error: null };
}

// ── Clubs that will be saved ─────────────────────────────────────────────────

export interface ConfirmClubSummary extends PlannableSummary {
  shotCount: number;
}

export interface ConfirmClub {
  id: number;
  name: string;
  tags: string[];
  shotCount: number;
  comparedWith: string | null;
}

function tagsOf(summary: PlannableSummary): string[] {
  return Array.isArray(summary.tags)
    ? (summary.tags as unknown[]).filter(
        (tag): tag is string => typeof tag === "string" && tag.trim() !== "",
      )
    : [];
}

function labelOf(summary: PlannableSummary): string {
  const tags = tagsOf(summary);
  return tags.length > 0
    ? `${summary.clubName} (${tags.join(", ")})`
    : summary.clubName;
}

// Uses the same planner as finalization, so the list matches exactly what is
// persisted. Baseline clubs are shown only as the "compared with" label.
export function getConfirmClubs(
  summaries: readonly ConfirmClubSummary[],
): ConfirmClub[] {
  const rows = flattenPlan(planComparisonGroups(summaries));
  return rows
    .filter((row) => row.clubRole === "demo")
    .map((row) => {
      const current =
        row.currentRowIndex !== null ? rows[row.currentRowIndex]! : null;
      return {
        id: row.summary.id,
        name: row.summary.clubName,
        tags: tagsOf(row.summary),
        shotCount: (row.summary as ConfirmClubSummary).shotCount,
        comparedWith: current ? labelOf(current.summary) : null,
      };
    });
}

// ── Fitting details ──────────────────────────────────────────────────────────

export function formatFittingDate(date: Date | null): string | null {
  if (!date) return null;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
