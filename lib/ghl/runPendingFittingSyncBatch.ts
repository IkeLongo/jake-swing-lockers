import type { PrismaClient } from "@/app/generated/prisma/client";
import { isCustomerContactSyncEnabled } from "./customerContactSyncProcessor";
import { runClaimedStagedFittingSync, type ClaimedStagedSyncResult } from "./runClaimedStagedFittingSync";

interface Candidate {
  id: number;
  updatedAt: Date;
  importBatches: { id: number }[];
}

interface Dependencies {
  listCandidates(): Promise<Candidate[]>;
  rotate(candidate: Candidate): Promise<boolean>;
  sync(batchId: number, sessionId: number): Promise<ClaimedStagedSyncResult>;
}

function createDependencies(db: PrismaClient): Dependencies {
  const batchWhere = { parserMode: "trackman-result", status: "finalized" };
  return {
    listCandidates: () => db.demoSession.findMany({
      where: {
        status: "finalized",
        needsRefinalization: false,
        OR: [
          { ghlSyncStatus: null },
          { ghlSyncStatus: "failed" },
          { ghlSyncStatus: "contact_resolved" },
        ],
        client: {
          ghlContactId: { not: null },
          syncState: { is: { workStatus: "synced", contactVerificationStatus: "verified" } },
        },
        importBatches: { some: batchWhere },
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: 10,
      select: {
        id: true,
        updatedAt: true,
        importBatches: {
          where: batchWhere,
          select: { id: true },
          orderBy: { id: "asc" },
          take: 2,
        },
      },
    }),
    rotate: async (candidate) => {
      const updated = await db.demoSession.updateMany({
        where: { id: candidate.id, updatedAt: candidate.updatedAt },
        data: { updatedAt: new Date(Math.max(Date.now(), candidate.updatedAt.getTime() + 1)) },
      });
      return updated.count === 1;
    },
    sync: (batchId, sessionId) =>
      runClaimedStagedFittingSync(db, batchId, sessionId, {
        recovery: true,
        requestTimeoutMs: 5_000,
      }),
  };
}

export async function runPendingFittingSyncBatch(
  options: { stopStartingAfterMs: number },
  dependencies?: Dependencies,
): Promise<{ status: "disabled" | "completed"; scanned: number; attempted: number; succeeded: number; retryable: number; needsReview: number; skipped: number; errors: number }> {
  if (!Number.isSafeInteger(options.stopStartingAfterMs) || options.stopStartingAfterMs < 1) {
    throw new RangeError("stopStartingAfterMs must be a positive integer.");
  }
  const summary = { status: "completed" as "disabled" | "completed", scanned: 0, attempted: 0, succeeded: 0, retryable: 0, needsReview: 0, skipped: 0, errors: 0 };
  if (!isCustomerContactSyncEnabled()) return { ...summary, status: "disabled" };
  const startedAt = Date.now();
  const deps = dependencies ?? createDependencies((await import("@/lib/db")).db);
  const candidates = await deps.listCandidates();
  for (const candidate of candidates) {
    if (!isCustomerContactSyncEnabled()) return { ...summary, status: "disabled" };
    if (Date.now() - startedAt >= options.stopStartingAfterMs) break;
    summary.scanned++;
    try {
      if (!await deps.rotate(candidate)) {
        summary.skipped++;
        continue;
      }
      if (candidate.importBatches.length !== 1) {
        console.error("[pending-fitting-sync] Fitting has multiple finalized import batches; staff review is required.", { sessionId: candidate.id });
        summary.skipped++;
        continue;
      }
      if (!isCustomerContactSyncEnabled()) return { ...summary, status: "disabled" };
      if (Date.now() - startedAt >= options.stopStartingAfterMs) break;
      const result = await deps.sync(candidate.importBatches[0].id, candidate.id);
      if (result.status !== "result") {
        summary.skipped++;
        continue;
      }
      summary.attempted++;
      if (result.result.ok) {
        summary.succeeded++;
      } else {
        const retryable = result.result.status === "failed"
          ? result.result.retryable
          : result.result.httpStatus === 503;
        if (retryable) summary.retryable++;
        else summary.needsReview++;
        console.error("[pending-fitting-sync] Fitting recovery did not complete.", {
          sessionId: candidate.id,
          code: result.result.code,
          retryable,
        });
      }
      break;
    } catch (error) {
      summary.errors++;
      console.error("[pending-fitting-sync] Recovery failed; inspect fitting sync state.", {
        sessionId: candidate.id,
        errorType: error instanceof Error ? error.name : "unknown",
      });
      break;
    }
  }
  return summary;
}
