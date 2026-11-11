import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@/app/generated/prisma/client";

export interface CustomerSyncClaim {
  golfClientId: number;
  token: string;
  version: number;
}

export type CustomerSyncClaimResult =
  | { status: "claimed"; claim: CustomerSyncClaim }
  | { status: "unavailable" }
  | { status: "needs_reconciliation" };

export type CustomerSyncTransitionResult =
  | { status: "applied" }
  | { status: "lost_claim" }
  | { status: "needs_reconciliation" };

export type CustomerSyncFailure =
  | {
      kind: "retryable";
      retrySafety: "no_remote_write" | "definitively_rejected";
      delayMs: number;
      code: string;
      message: string;
    }
  | { kind: "review" | "reconciliation"; code: string; message: string };

type RawLockedState = {
  workStatus: string;
  desiredVersion: number | bigint;
  syncedVersion: number | bigint;
  claimedVersion: number | bigint | null;
  claimToken: string | null;
  leaseExpiresAt: Date | null;
  creationAttemptId: string | null;
  creationAttemptVersion: number | bigint | null;
  creationAttemptStatus: string | null;
  creationAttemptedAt: Date | null;
  retryDue: number | bigint | null;
  leaseValid: number | bigint | null;
};

type LockedState = Omit<
  RawLockedState,
  "desiredVersion" | "syncedVersion" | "claimedVersion" | "creationAttemptVersion"
> & {
  desiredVersion: number;
  syncedVersion: number;
  claimedVersion: number | null;
  creationAttemptVersion: number | null;
};

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 };
const MAX_DELAY_MS = 24 * 60 * 60 * 1000;
const MAX_UNSIGNED_INT = 0xffff_ffff;

function readVersion(value: number | bigint, field: string): number {
  if (typeof value !== "number" && typeof value !== "bigint") {
    throw new Error(`Invalid ${field} in customer sync state.`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > MAX_UNSIGNED_INT) {
    throw new Error(`Invalid ${field} in customer sync state.`);
  }
  return number;
}

function readNullableVersion(value: number | bigint | null, field: string): number | null {
  return value === null ? null : readVersion(value, field);
}

function assertDuration(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_DELAY_MS) {
    throw new RangeError(`${label} must be an integer between 1 and ${MAX_DELAY_MS} milliseconds.`);
  }
}

function assertClientId(id: number): void {
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new RangeError("golfClientId must be a positive safe integer.");
  }
}

function assertClaim(claim: CustomerSyncClaim): void {
  assertClientId(claim.golfClientId);
  if (!claim.token || !Number.isSafeInteger(claim.version) || claim.version < 1) {
    throw new Error("A valid customer sync claim token and version are required.");
  }
}

async function lockCustomerAndState(
  tx: Prisma.TransactionClient,
  golfClientId: number,
): Promise<{ state: LockedState; legacyCreationClaim: boolean } | null> {
  const customers = await tx.$queryRaw<Array<{ id: number }>>`
    SELECT id FROM GolfClient WHERE id = ${golfClientId} FOR UPDATE
  `;
  if (customers.length === 0) return null;

  const customer = await tx.golfClient.findUniqueOrThrow({
    where: { id: golfClientId },
    select: { ghlContactCreationState: true },
  });
  const rows = await tx.$queryRaw<RawLockedState[]>`
    SELECT workStatus, desiredVersion, syncedVersion, claimedVersion, claimToken,
      leaseExpiresAt, creationAttemptId, creationAttemptVersion,
      creationAttemptStatus, creationAttemptedAt,
      nextAttemptAt <= CURRENT_TIMESTAMP(3) AS retryDue,
      leaseExpiresAt > CURRENT_TIMESTAMP(3) AS leaseValid
    FROM GolfClientSyncState WHERE golfClientId = ${golfClientId} FOR UPDATE
  `;
  const raw = rows[0];
  if (!raw) return null;
  const state: LockedState = {
    ...raw,
    desiredVersion: readVersion(raw.desiredVersion, "desiredVersion"),
    syncedVersion: readVersion(raw.syncedVersion, "syncedVersion"),
    claimedVersion: readNullableVersion(raw.claimedVersion, "claimedVersion"),
    creationAttemptVersion: readNullableVersion(raw.creationAttemptVersion, "creationAttemptVersion"),
  };
  return { state, legacyCreationClaim: customer.ghlContactCreationState !== null };
}

function hasCreationAttempt(
  row: NonNullable<Awaited<ReturnType<typeof lockCustomerAndState>>>,
): boolean {
  return (
    row.legacyCreationClaim ||
    row.state.creationAttemptId !== null ||
    row.state.creationAttemptVersion !== null ||
    row.state.creationAttemptStatus !== null ||
    row.state.creationAttemptedAt !== null
  );
}

async function requireReconciliation(
  tx: Prisma.TransactionClient,
  golfClientId: number,
  code: string,
  message: string,
): Promise<void> {
  await tx.golfClientSyncState.update({
    where: { golfClientId },
    data: {
      workStatus: "needs_reconciliation",
      claimToken: null,
      claimedVersion: null,
      leaseExpiresAt: null,
      nextAttemptAt: null,
      lastErrorCode: code,
      lastError: message,
    },
  });
}

/**
 * Returns candidate IDs only; selection is not a claim. Callers must still
 * claim each ID atomically. No scheduler or worker is started by this module.
 */
export async function listCustomerSyncCandidates(
  db: PrismaClient,
  limit: number,
): Promise<number[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new RangeError("limit must be an integer between 1 and 1000.");
  }
  const rows = await db.$queryRaw<Array<{ golfClientId: number }>>`
    SELECT golfClientId FROM GolfClientSyncState
    WHERE workStatus = 'pending'
       OR (workStatus = 'retryable_failed' AND nextAttemptAt <= CURRENT_TIMESTAMP(3))
       OR (workStatus = 'processing' AND
           (leaseExpiresAt IS NULL OR leaseExpiresAt <= CURRENT_TIMESTAMP(3)))
    ORDER BY golfClientId ASC LIMIT ${limit}
  `;
  return rows.map((row) => row.golfClientId);
}

export async function claimCustomerSync(
  db: PrismaClient,
  golfClientId: number,
  leaseMs: number,
): Promise<CustomerSyncClaimResult> {
  assertClientId(golfClientId);
  assertDuration(leaseMs, "leaseMs");
  return db.$transaction(async (tx) => {
    const row = await lockCustomerAndState(tx, golfClientId);
    if (!row) return { status: "unavailable" };
    const { state } = row;
    if (state.workStatus === "processing") {
      if (Number(state.leaseValid) === 1) return { status: "unavailable" };
      await requireReconciliation(
        tx, golfClientId, "expired_lease",
        "The customer sync lease expired; an external operation may have completed. Reconcile before retrying.",
      );
      return { status: "needs_reconciliation" };
    }
    if (
      state.workStatus !== "pending" &&
      !(state.workStatus === "retryable_failed" && Number(state.retryDue) === 1)
    ) {
      return { status: "unavailable" };
    }
    if (
      hasCreationAttempt(row) ||
      state.claimToken !== null ||
      state.claimedVersion !== null ||
      state.leaseExpiresAt !== null ||
      state.syncedVersion > state.desiredVersion ||
      state.desiredVersion < 1
    ) {
      await requireReconciliation(
        tx, golfClientId, "inconsistent_sync_state",
        "Customer sync contains an unresolved creation attempt or inconsistent claim. Reconcile before retrying.",
      );
      return { status: "needs_reconciliation" };
    }
    const token = randomUUID();
    await tx.$executeRaw`
      UPDATE GolfClientSyncState
      SET workStatus = 'processing', claimToken = ${token},
          claimedVersion = desiredVersion, attemptCount = attemptCount + 1,
          lastAttemptAt = CURRENT_TIMESTAMP(3), nextAttemptAt = NULL,
          leaseExpiresAt = TIMESTAMPADD(MICROSECOND, ${leaseMs * 1000}, CURRENT_TIMESTAMP(3)),
          updatedAt = CURRENT_TIMESTAMP(3)
      WHERE golfClientId = ${golfClientId}
    `;
    return {
      status: "claimed",
      claim: { golfClientId, token, version: state.desiredVersion },
    };
  }, TRANSACTION_OPTIONS);
}

async function transitionCustomerSync(
  db: PrismaClient,
  claim: CustomerSyncClaim,
  failure: CustomerSyncFailure | null,
): Promise<CustomerSyncTransitionResult> {
  assertClaim(claim);
  if (failure) {
    if (!failure.code.trim() || failure.code.length > 64 || !failure.message.trim()) {
      throw new Error("A non-empty error code (at most 64 characters) and message are required.");
    }
    if (failure.kind === "retryable") {
      assertDuration(failure.delayMs, "delayMs");
      if (failure.retrySafety !== "no_remote_write" && failure.retrySafety !== "definitively_rejected") {
        throw new Error("Retryable failures require a definitive safe-to-retry classification.");
      }
    }
  }
  return db.$transaction(async (tx) => {
    const row = await lockCustomerAndState(tx, claim.golfClientId);
    if (
      !row ||
      row.state.workStatus !== "processing" ||
      row.state.claimToken !== claim.token ||
      row.state.claimedVersion !== claim.version ||
      Number(row.state.leaseValid) !== 1
    ) {
      return { status: "lost_claim" };
    }

    if (
      hasCreationAttempt(row) ||
      row.state.syncedVersion > claim.version ||
      row.state.desiredVersion < claim.version
    ) {
      // The update is still fenced against lease expiry during this transaction.
      const updated = await tx.$executeRaw`
        UPDATE GolfClientSyncState
        SET workStatus = 'needs_reconciliation', claimToken = NULL,
            claimedVersion = NULL, leaseExpiresAt = NULL, nextAttemptAt = NULL,
            lastErrorCode = 'inconsistent_sync_state',
            lastError = 'An unresolved creation attempt or inconsistent version requires reconciliation.',
            updatedAt = CURRENT_TIMESTAMP(3)
        WHERE golfClientId = ${claim.golfClientId} AND workStatus = 'processing'
          AND claimToken = ${claim.token} AND claimedVersion = ${claim.version}
          AND leaseExpiresAt > CURRENT_TIMESTAMP(3)
      `;
      return { status: updated === 1 ? "needs_reconciliation" : "lost_claim" };
    }

    let updated: number;
    if (!failure) {
      updated = await tx.$executeRaw`
        UPDATE GolfClientSyncState
        SET syncedVersion = ${claim.version},
            workStatus = CASE WHEN desiredVersion > ${claim.version} THEN 'pending' ELSE 'synced' END,
            claimToken = NULL, claimedVersion = NULL, leaseExpiresAt = NULL,
            nextAttemptAt = NULL, lastErrorCode = NULL, lastError = NULL,
            updatedAt = CURRENT_TIMESTAMP(3)
        WHERE golfClientId = ${claim.golfClientId} AND workStatus = 'processing'
          AND claimToken = ${claim.token} AND claimedVersion = ${claim.version}
          AND leaseExpiresAt > CURRENT_TIMESTAMP(3)
      `;
    } else if (failure.kind === "retryable") {
      updated = await tx.$executeRaw`
        UPDATE GolfClientSyncState
        SET workStatus = 'retryable_failed', claimToken = NULL, claimedVersion = NULL,
            leaseExpiresAt = NULL,
            nextAttemptAt = TIMESTAMPADD(MICROSECOND, ${failure.delayMs * 1000}, CURRENT_TIMESTAMP(3)),
            lastErrorCode = ${failure.code}, lastError = ${failure.message},
            updatedAt = CURRENT_TIMESTAMP(3)
        WHERE golfClientId = ${claim.golfClientId} AND workStatus = 'processing'
          AND claimToken = ${claim.token} AND claimedVersion = ${claim.version}
          AND leaseExpiresAt > CURRENT_TIMESTAMP(3)
      `;
    } else {
      const status = failure.kind === "review" ? "needs_review" : "needs_reconciliation";
      updated = await tx.$executeRaw`
        UPDATE GolfClientSyncState
        SET workStatus = ${status}, claimToken = NULL, claimedVersion = NULL,
            leaseExpiresAt = NULL, nextAttemptAt = NULL,
            lastErrorCode = ${failure.code}, lastError = ${failure.message},
            updatedAt = CURRENT_TIMESTAMP(3)
        WHERE golfClientId = ${claim.golfClientId} AND workStatus = 'processing'
          AND claimToken = ${claim.token} AND claimedVersion = ${claim.version}
          AND leaseExpiresAt > CURRENT_TIMESTAMP(3)
      `;
    }
    return { status: updated === 1 ? "applied" : "lost_claim" };
  }, TRANSACTION_OPTIONS);
}

export function completeCustomerSync(
  db: PrismaClient,
  claim: CustomerSyncClaim,
): Promise<CustomerSyncTransitionResult> {
  return transitionCustomerSync(db, claim, null);
}

export function failCustomerSync(
  db: PrismaClient,
  claim: CustomerSyncClaim,
  failure: CustomerSyncFailure,
): Promise<CustomerSyncTransitionResult> {
  return transitionCustomerSync(db, claim, failure);
}
