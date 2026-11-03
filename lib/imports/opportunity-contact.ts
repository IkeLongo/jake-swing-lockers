import {
  getCurrentGhlDecision,
  type GhlGateBatch,
  type GhlGateClient,
} from "./ghl-approval-gate";

// Which GHL contact a staged fitting's opportunity must belong to, derived
// only from the persisted, still-current approval. GolfClient.ghlContactId is
// intentionally not consulted: a saved link is never an approval.
export type OpportunityContactScope =
  | { kind: "approval_required" }
  | { kind: "existing"; contactId: string }
  | { kind: "new" };

export function getOpportunityContactScope(
  batch: GhlGateBatch,
  client: GhlGateClient | null,
): OpportunityContactScope {
  const decision = getCurrentGhlDecision(batch, client);
  if (decision === "existing" && batch.approvedGhlContactId) {
    return { kind: "existing", contactId: batch.approvedGhlContactId };
  }
  if (decision === "new") return { kind: "new" };
  return { kind: "approval_required" };
}
