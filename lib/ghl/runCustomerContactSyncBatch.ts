import {
  isCustomerContactSyncEnabled,
  processCustomerContactSync,
  type CustomerContactSyncResult,
} from "./customerContactSyncProcessor";
import { listCustomerSyncCandidates } from "./customerSyncWorkerState";

export const DEFAULT_CUSTOMER_SYNC_BATCH_SIZE = 5;
export const MAX_CUSTOMER_SYNC_BATCH_SIZE = 10;

export interface CustomerContactSyncBatchSummary {
  processed: number;
  succeeded: number;
  retryScheduled: number;
  needsReview: number;
  needsReconciliation: number;
  skipped: number;
  errors: number;
}

export type CustomerContactSyncBatchResult =
  | { status: "disabled"; summary: CustomerContactSyncBatchSummary }
  | { status: "completed"; summary: CustomerContactSyncBatchSummary };

interface BatchDependencies {
  listCandidates(limit: number): Promise<number[]>;
  processCustomer(id: number): Promise<CustomerContactSyncResult>;
}

export async function runCustomerContactSyncBatch(
  limit = DEFAULT_CUSTOMER_SYNC_BATCH_SIZE,
  dependencies?: BatchDependencies,
  options?: { stopStartingAfterMs: number },
): Promise<CustomerContactSyncBatchResult> {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_CUSTOMER_SYNC_BATCH_SIZE
  ) {
    throw new RangeError(
      `Batch size must be an integer between 1 and ${MAX_CUSTOMER_SYNC_BATCH_SIZE}.`,
    );
  }
  if (options && (!Number.isSafeInteger(options.stopStartingAfterMs) || options.stopStartingAfterMs < 1)) {
    throw new RangeError("stopStartingAfterMs must be a positive integer.");
  }

  const summary: CustomerContactSyncBatchSummary = {
    processed: 0,
    succeeded: 0,
    retryScheduled: 0,
    needsReview: 0,
    needsReconciliation: 0,
    skipped: 0,
    errors: 0,
  };
  if (!isCustomerContactSyncEnabled()) return { status: "disabled", summary };

  const deps = dependencies ?? {
    listCandidates: async (count: number) =>
      listCustomerSyncCandidates((await import("@/lib/db")).db, count),
    processCustomer: processCustomerContactSync,
  };
  const startedAt = Date.now();
  const candidates = await deps.listCandidates(limit);
  for (const id of candidates) {
    if (!isCustomerContactSyncEnabled()) return { status: "disabled", summary };
    if (options && Date.now() - startedAt >= options.stopStartingAfterMs) break;
    summary.processed++;
    try {
      const result = await deps.processCustomer(id);
      switch (result.status) {
        case "synced":
          summary.succeeded++;
          break;
        case "retry_scheduled":
          summary.retryScheduled++;
          break;
        case "needs_review":
          summary.needsReview++;
          break;
        case "needs_reconciliation":
          summary.needsReconciliation++;
          break;
        case "unavailable":
          summary.skipped++;
          break;
        case "disabled":
          summary.skipped++;
          return { status: "disabled", summary };
      }
    } catch {
      summary.errors++;
      console.error("[customer-contact-sync-batch] A customer sync failed unexpectedly.");
    }
  }
  return { status: "completed", summary };
}
