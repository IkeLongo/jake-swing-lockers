import type { PrismaClient } from "@/app/generated/prisma/client";
import { claimFittingSyncResult, releaseFittingSync } from "./fittingSyncClaim";
import { decodeSyncError, hasUnresolvedCustomerCreation } from "./syncErrorMarker";
import { syncStagedFittingToGHL, type StagedSyncBatch, type StagedSyncResult } from "./syncStagedFitting";
import { createPrismaStagedSyncDeps } from "./syncStagedFittingStore";

export function isFittingReadyForRecovery(batch: StagedSyncBatch | null): boolean {
  const session = batch?.demoSession;
  const client = session?.client;
  const state = client?.syncState;
  return Boolean(
    batch?.parserMode === "trackman-result" && batch.status === "finalized" &&
    session?.status === "finalized" && !session.needsRefinalization &&
    session.ghlSyncStatus !== "synced" && !decodeSyncError(session.ghlSyncError).actionRequired &&
    client?.ghlContactId && !hasUnresolvedCustomerCreation(client) &&
    state?.workStatus === "synced" && state.contactVerificationStatus === "verified" &&
    state.verifiedGhlLocationId === process.env.GHL_SWINGLOCKER_LOCATION_ID &&
    Boolean(state.verifiedGhlLocationId) && state.desiredVersion === state.syncedVersion,
  );
}

export type ClaimedStagedSyncResult =
  | { status: "customer_busy" | "blocked" | "skipped" }
  | { status: "result"; result: StagedSyncResult };

export async function runClaimedStagedFittingSync(
  db: PrismaClient,
  batchId: number,
  sessionId: number,
  options?: { recovery: boolean; requestTimeoutMs: number },
): Promise<ClaimedStagedSyncResult> {
  const claimResult = await claimFittingSyncResult(db, sessionId);
  if (claimResult.status !== "claimed") return claimResult;

  const token = claimResult.token;
  const deps = createPrismaStagedSyncDeps(db, options);
  const loadBatch = deps.loadBatch;
  deps.loadBatch = async (id) => {
    const current = await loadBatch(id);
    return current?.demoSession?.id === sessionId ? current : null;
  };

  if (options?.recovery) {
    let batch: StagedSyncBatch | null;
    try {
      batch = await deps.loadBatch(batchId);
    } catch (error) {
      await releaseFittingSync(db, sessionId, token);
      throw error;
    }
    if (!isFittingReadyForRecovery(batch)) {
      if (!await releaseFittingSync(db, sessionId, token)) return { status: "blocked" };
      return { status: "skipped" };
    }
  }

  const result = await syncStagedFittingToGHL(deps, batchId);
  const uncertain = !result.ok && result.status === "failed" &&
    (result.code === "creation-needs-reconciliation" || result.code === "sync-needs-reconciliation");
  if (!uncertain && !await releaseFittingSync(db, sessionId, token)) return { status: "blocked" };
  return { status: "result", result };
}
