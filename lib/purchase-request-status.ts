export const PURCHASE_REQUEST_STATUSES = [
  "new_request",
  "reviewing",
  "quote_sent",
  "purchased",
  "fulfilled",
  "closed_lost",
] as const;

export type PurchaseRequestStatus = (typeof PURCHASE_REQUEST_STATUSES)[number];

export const PURCHASE_REQUEST_EDITABLE_STATUSES = [
  "new_request",
  "reviewing",
  "quote_sent",
] as const;

export const PURCHASE_REQUEST_LOCKED_STATUSES = [
  "purchased",
  "fulfilled",
  "closed_lost",
] as const;

export const LEGACY_PURCHASE_REQUEST_STATUS_MAP = {
  pending: "new_request",
  contacted: "reviewing",
  completed: "fulfilled",
  cancelled: "closed_lost",
} as const;

export type LegacyPurchaseRequestStatus = keyof typeof LEGACY_PURCHASE_REQUEST_STATUS_MAP;

export const PURCHASE_REQUEST_STATUS_LABELS: Record<PurchaseRequestStatus, string> = {
  new_request: "New Request",
  reviewing: "Reviewing",
  quote_sent: "Quote Sent",
  purchased: "Purchased",
  fulfilled: "Fulfilled",
  closed_lost: "Closed Lost",
};

export const PURCHASE_REQUEST_STATUS_STYLES: Record<PurchaseRequestStatus, string> = {
  new_request: "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800/30",
  reviewing: "bg-blue-100 text-blue-900 dark:bg-blue-950/50 dark:text-blue-200 dark:border-blue-800/30",
  quote_sent: "bg-purple-100 text-purple-900 dark:bg-purple-950/50 dark:text-purple-200 dark:border-purple-800/30",
  purchased: "bg-green-100 text-green-900 dark:bg-green-950/50 dark:text-green-200 dark:border-green-800/30",
  fulfilled: "bg-teal-100 text-teal-900 dark:bg-teal-950/50 dark:text-teal-200 dark:border-teal-800/30",
  closed_lost: "bg-muted text-muted-foreground dark:bg-muted/50 dark:text-muted-foreground dark:border-muted/30",
};

export function toCanonicalPurchaseRequestStatus(
  status: string
): PurchaseRequestStatus | null {
  if ((PURCHASE_REQUEST_STATUSES as readonly string[]).includes(status)) {
    return status as PurchaseRequestStatus;
  }

  if (status in LEGACY_PURCHASE_REQUEST_STATUS_MAP) {
    return LEGACY_PURCHASE_REQUEST_STATUS_MAP[status as LegacyPurchaseRequestStatus];
  }

  return null;
}

export function getPurchaseRequestStatusLabel(status: string): string {
  const canonical = toCanonicalPurchaseRequestStatus(status);
  if (!canonical) return status;
  return PURCHASE_REQUEST_STATUS_LABELS[canonical];
}

export function isPurchaseRequestEditableStatus(status: string): boolean {
  const canonical = toCanonicalPurchaseRequestStatus(status);
  return (
    canonical != null &&
    (PURCHASE_REQUEST_EDITABLE_STATUSES as readonly string[]).includes(canonical)
  );
}

export function isPurchaseRequestLockedStatus(status: string): boolean {
  const canonical = toCanonicalPurchaseRequestStatus(status);
  return (
    canonical != null &&
    (PURCHASE_REQUEST_LOCKED_STATUSES as readonly string[]).includes(canonical)
  );
}
