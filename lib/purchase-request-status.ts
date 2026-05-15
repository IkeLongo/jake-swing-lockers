export const PURCHASE_REQUEST_STATUSES = [
  "new_request",
  "reviewing",
  "quote_sent",
  "purchased",
  "fulfilled",
  "closed_lost",
] as const;

export type PurchaseRequestStatus = (typeof PURCHASE_REQUEST_STATUSES)[number];

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
  new_request: "bg-yellow-100 text-yellow-700",
  reviewing: "bg-blue-100 text-blue-700",
  quote_sent: "bg-violet-100 text-violet-700",
  purchased: "bg-emerald-100 text-emerald-700",
  fulfilled: "bg-teal-100 text-teal-700",
  closed_lost: "bg-slate-100 text-slate-500",
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
