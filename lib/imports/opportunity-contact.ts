import {
  getCustomerContactDecision,
  type GhlGateBatch,
  type GhlGateClient,
} from "./ghl-approval-gate";

export type OpportunityContactScope =
  | { kind: "approval_required" }
  | { kind: "existing"; contactId: string }
  | { kind: "new" };

export function getOpportunityContactScope(
  batch: GhlGateBatch,
  client: GhlGateClient | null,
): OpportunityContactScope {
  const decision = getCustomerContactDecision(batch, client);
  if (decision === "existing" && client?.ghlContactId) {
    return { kind: "existing", contactId: client.ghlContactId };
  }
  if (decision === "new") return { kind: "new" };
  return { kind: "approval_required" };
}
