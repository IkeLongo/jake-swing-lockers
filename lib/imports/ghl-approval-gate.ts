import {
  getApprovalStatus,
  hasCurrentGhlApproval,
  resolveBatchLocalIdentity,
  type GhlApprovalStatus,
  type GhlContactDecision,
} from "./ghl-contact-approval";

// Local-only (no GHL request) check of a batch's persisted GHL contact
// decision against its current local customer identity. Used by the workflow
// routing guards and the Opportunity API.

/** Columns a page or route must select to evaluate the gate. */
export const GHL_APPROVAL_BATCH_SELECT = {
  ghlContactDecision: true,
  approvedGhlContactId: true,
  ghlContactApprovalSignature: true,
  ghlContactReviewSnapshot: true,
} as const;

export interface GhlGateBatch {
  customerResolution: string | null;
  selectedGolfClientId: number | null;
  proposedFirstName: string | null;
  proposedLastName: string | null;
  proposedEmail: string | null;
  proposedPhone: string | null;
  ghlContactDecision: string | null;
  approvedGhlContactId: string | null;
  ghlContactApprovalSignature: string | null;
  ghlContactReviewSnapshot: unknown;
}

export interface GhlGateClient {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  ghlContactId?: string | null;
}

export function getBatchGhlApprovalStatus(
  batch: GhlGateBatch,
  client: GhlGateClient | null,
): GhlApprovalStatus {
  return getApprovalStatus(
    {
      decision: batch.ghlContactDecision,
      approvedContactId: batch.approvedGhlContactId,
      signature: batch.ghlContactApprovalSignature,
      approvedAt: null,
      approvedByStaffUserId: null,
      snapshot: batch.ghlContactReviewSnapshot,
    },
    resolveBatchLocalIdentity(batch, client),
  );
}

/** The approved decision when it is complete and current; otherwise null. */
export function getCurrentGhlDecision(
  batch: GhlGateBatch,
  client: GhlGateClient | null,
): GhlContactDecision | null {
  const status = getBatchGhlApprovalStatus(batch, client);
  if (!hasCurrentGhlApproval(status)) return null;
  return status === "approved_existing" ? "existing" : "new";
}

export function getCustomerContactDecision(
  batch: GhlGateBatch,
  client: GhlGateClient | null,
): GhlContactDecision | null {
  if (batch.customerResolution === "new") return "new";
  if (batch.customerResolution !== "existing" || !batch.selectedGolfClientId || !client) return null;
  return client.ghlContactId?.trim() ? "existing" : "new";
}
