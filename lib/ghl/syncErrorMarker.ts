// Durable retryable/non-retryable marker for staged CRM sync failures.
//
// DemoSession only persists a status and an error text, so a failure that
// needs human action (unresolved contact, closed opportunity) is stored with a
// fixed prefix. This lets a refreshed Confirm page stay non-retryable without a
// schema change. Plain messages are treated as retryable.

const ACTION_REQUIRED_PREFIX = "[action-required] ";

export const FITTING_RECONCILIATION_MESSAGE =
  "This fitting has an active or interrupted CRM sync or an unresolved creation attempt. Staff review and reconciliation are required before retrying.";

export function hasUnresolvedCustomerCreation(client: {
  ghlContactCreationState?: unknown;
  syncState?: {
    creationAttemptId?: string | null;
    creationAttemptVersion?: number | null;
    creationAttemptStatus?: string | null;
    creationAttemptedAt?: Date | null;
  } | null;
}): boolean {
  const state = client.syncState;
  return client.ghlContactCreationState != null || Boolean(state && (
    state.creationAttemptId != null || state.creationAttemptVersion != null ||
    state.creationAttemptStatus != null || state.creationAttemptedAt != null
  ));
}

export function hasUnresolvedFittingSyncState(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value !== "object" || Array.isArray(value)) return true;
  const state = value as Record<string, unknown>;
  if (state.version !== 1 || state.fittingClaim !== undefined || state.opportunity !== undefined) return true;
  if (state.contact === undefined) return false;
  const contact = state.contact;
  return !contact || typeof contact !== "object" || Array.isArray(contact) ||
    (contact as Record<string, unknown>).status !== "resolved" ||
    !Number.isSafeInteger((contact as Record<string, unknown>).batchId) ||
    !Number.isSafeInteger((contact as Record<string, unknown>).clientId) ||
    typeof (contact as Record<string, unknown>).contactId !== "string" ||
    !(contact as Record<string, unknown>).contactId;
}

const CONTACT_APPROVAL_ERRORS = new Set([
  "The GHL contact approval is stale. Review and approve it again before syncing.",
  "The local customer is linked to a different GHL contact than the one approved for this fitting.",
  "This customer already has a saved GHL contact. Review the customer decision instead of creating or reusing another contact.",
  "This customer already has a verified GHL contact. Review and approve that contact instead of creating another.",
]);

export function isContactApprovalRecoveryError(message: string | null): boolean {
  return message !== null && CONTACT_APPROVAL_ERRORS.has(message);
}

export function encodeSyncError(message: string, retryable: boolean): string {
  return retryable ? message : `${ACTION_REQUIRED_PREFIX}${message}`;
}

export function decodeSyncError(
  stored: string | null | undefined,
): { message: string | null; actionRequired: boolean } {
  if (!stored) return { message: null, actionRequired: false };
  if (stored.startsWith(ACTION_REQUIRED_PREFIX)) {
    return {
      message: stored.slice(ACTION_REQUIRED_PREFIX.length),
      actionRequired: true,
    };
  }
  return { message: stored, actionRequired: false };
}
