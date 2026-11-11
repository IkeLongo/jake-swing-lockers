import type { Prisma } from "@/app/generated/prisma/client";
import {
  CUSTOMER_SYNC_STATUSES,
  type CustomerSyncStatus,
} from "./customerSyncState";

export type CustomerSyncWorkStatus = CustomerSyncStatus;

export interface EnqueueCustomerSyncInput {
  golfClientId: number;
  reason: "created" | "profile_changed";
}

export interface EnqueueCustomerSyncResult {
  desiredVersion: number;
  workStatus: CustomerSyncWorkStatus;
}

export class CustomerSyncOutboxError extends Error {
  readonly code = "customer_not_found" as const;

  constructor(golfClientId: number) {
    super(`GolfClient ${golfClientId} was not found.`);
    this.name = "CustomerSyncOutboxError";
  }
}

type LegacyCreationClaim = "none" | "known_in_flight" | "unknown";

function classifyLegacyCreationClaim(value: unknown): LegacyCreationClaim {
  if (value === null || value === undefined) return "none";
  if (typeof value !== "object" || Array.isArray(value)) return "unknown";

  const claim = value as Record<string, unknown>;
  if (
    claim.version === 1 &&
    claim.status === "creating" &&
    Number.isSafeInteger(claim.sessionId) &&
    Number.isSafeInteger(claim.batchId) &&
    typeof claim.attemptedAt === "string"
  ) {
    return "known_in_flight";
  }

  return "unknown";
}

function isCustomerSyncStatus(value: string): value is CustomerSyncWorkStatus {
  return (CUSTOMER_SYNC_STATUSES as readonly string[]).includes(value);
}

function requiresReconciliationForClaim(
  legacyClaim: LegacyCreationClaim,
  creationAttemptStatus: string | null,
): boolean {
  return legacyClaim !== "none" || creationAttemptStatus !== null;
}

/**
 * Enqueues the latest GolfClient profile for customer-level synchronization.
 * The caller owns the transaction; this function never opens one or calls GHL.
 */
export async function enqueueCustomerSync(
  tx: Prisma.TransactionClient,
  input: EnqueueCustomerSyncInput,
): Promise<EnqueueCustomerSyncResult> {
  const lockedClients = await tx.$queryRaw<Array<{ id: number }>>`
    SELECT id FROM GolfClient WHERE id = ${input.golfClientId} FOR UPDATE
  `;
  if (lockedClients.length === 0) {
    throw new CustomerSyncOutboxError(input.golfClientId);
  }

  const client = await tx.golfClient.findUnique({
    where: { id: input.golfClientId },
    select: { ghlContactCreationState: true },
  });
  if (!client) {
    throw new CustomerSyncOutboxError(input.golfClientId);
  }

  const legacyClaim = classifyLegacyCreationClaim(client.ghlContactCreationState);
  const current = await tx.golfClientSyncState.findUnique({
    where: { golfClientId: input.golfClientId },
    select: {
      desiredVersion: true,
      workStatus: true,
      creationAttemptStatus: true,
    },
  });

  if (!current) {
    const blockedByCreationClaim = requiresReconciliationForClaim(
      legacyClaim,
      null,
    );
    const workStatus: CustomerSyncWorkStatus = blockedByCreationClaim
      ? "needs_reconciliation"
      : "pending";
    const state = await tx.golfClientSyncState.create({
      data: {
        golfClientId: input.golfClientId,
        desiredVersion: 1,
        syncedVersion: 0,
        workStatus,
        contactVerificationStatus: "unverified",
        ...(blockedByCreationClaim
          ? {
              lastErrorCode:
                legacyClaim === "known_in_flight"
                  ? "legacy_creation_claim"
                  : "unknown_legacy_creation_state",
              lastError:
                "A historical GHL contact creation claim must be reconciled before customer synchronization.",
            }
          : {}),
      },
      select: { desiredVersion: true, workStatus: true },
    });
    return {
      desiredVersion: state.desiredVersion,
      workStatus: state.workStatus as CustomerSyncWorkStatus,
    };
  }

  let workStatus: CustomerSyncWorkStatus;
  if (!isCustomerSyncStatus(current.workStatus)) {
    workStatus = "needs_reconciliation";
  } else if (
    requiresReconciliationForClaim(legacyClaim, current.creationAttemptStatus) &&
    current.workStatus !== "needs_review" &&
    current.workStatus !== "needs_reconciliation" &&
    current.workStatus !== "processing"
  ) {
    workStatus = "needs_reconciliation";
  } else if (current.workStatus === "synced") {
    workStatus = "pending";
  } else {
    workStatus = current.workStatus;
  }

  const state = await tx.golfClientSyncState.update({
    where: { golfClientId: input.golfClientId },
    data: {
      desiredVersion: { increment: 1 },
      ...(workStatus !== current.workStatus ? { workStatus } : {}),
    },
    select: { desiredVersion: true, workStatus: true },
  });

  return {
    desiredVersion: state.desiredVersion,
    workStatus: state.workStatus as CustomerSyncWorkStatus,
  };
}
