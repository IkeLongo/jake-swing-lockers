import { processCustomerContactSync, type CustomerContactSyncResult } from "./customerContactSyncProcessor";

export type CustomerSyncAttempt = "synced" | "pending" | "needs_review" | "needs_reconciliation" | "disabled";

export async function attemptCustomerSync(
  customerId: number,
  process: (id: number) => Promise<CustomerContactSyncResult> = processCustomerContactSync,
): Promise<CustomerSyncAttempt> {
  try {
    const result = await process(customerId);
    if (result.status === "retry_scheduled" || result.status === "unavailable") return "pending";
    return result.status;
  } catch (error) {
    console.error(
      "[customer-contact-sync] Immediate attempt failed; inspect customer sync state.",
      { customerId, errorType: error instanceof Error ? error.name : "unknown" },
    );
    return "needs_reconciliation";
  }
}
