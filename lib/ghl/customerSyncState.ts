export const CUSTOMER_SYNC_STATUSES = [
  "pending",
  "processing",
  "synced",
  "retryable_failed",
  "needs_review",
  "needs_reconciliation",
] as const;

export type CustomerSyncStatus = (typeof CUSTOMER_SYNC_STATUSES)[number];

export const CUSTOMER_CONTACT_VERIFICATION_STATUSES = [
  "unverified",
  "verified",
  "needs_review",
] as const;

export type CustomerContactVerificationStatus =
  (typeof CUSTOMER_CONTACT_VERIFICATION_STATUSES)[number];

export const CUSTOMER_CREATION_ATTEMPT_STATUSES = [
  "started",
  "unknown",
] as const;

export type CustomerCreationAttemptStatus =
  (typeof CUSTOMER_CREATION_ATTEMPT_STATUSES)[number];
