import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, type Prisma as PrismaTypes } from "@/app/generated/prisma/client";
import type { CustomerSyncClaim } from "./customerSyncWorkerState";
import { isValidGhlContactId } from "@/lib/imports/ghl-contact-approval";

type Owner =
  | { kind: "worker"; token: string; version: number }
  | { kind: "standalone" };

export interface ContactCreationAttempt {
  golfClientId: number;
  id: string;
  version: number;
}

export type ReservationResult =
  | { status: "reserved"; attempt: ContactCreationAttempt }
  | { status: "linked"; contactId: string }
  | { status: "blocked"; reason: string };

export type AttemptTransitionResult =
  | { status: "applied" }
  | { status: "lost_attempt" }
  | { status: "needs_reconciliation" }
  | { status: "contact_conflict" };

interface Marker {
  version: 2;
  status: "creating";
  attemptId: string;
  attemptVersion: number;
  owner: Owner;
}

const OPTIONS = { maxWait: 10_000, timeout: 30_000 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertId(id: number): void {
  if (!Number.isSafeInteger(id) || id < 1) throw new RangeError("Invalid customer ID.");
}

function assertAttempt(attempt: ContactCreationAttempt): void {
  assertId(attempt.golfClientId);
  if (!UUID.test(attempt.id) || !Number.isSafeInteger(attempt.version) || attempt.version < 1) {
    throw new Error("Invalid contact creation attempt.");
  }
}

function markerFor(value: PrismaTypes.JsonValue | null): Marker | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const owner = value.owner;
  if (!owner || typeof owner !== "object" || Array.isArray(owner)) return null;
  if (
    value.version !== 2 || value.status !== "creating" ||
    typeof value.attemptId !== "string" || !UUID.test(value.attemptId) ||
    typeof value.attemptVersion !== "number" ||
    !Number.isSafeInteger(value.attemptVersion) || value.attemptVersion < 1
  ) return null;
  if (owner.kind === "standalone") {
    return { version: 2, status: "creating", attemptId: value.attemptId, attemptVersion: value.attemptVersion, owner: { kind: "standalone" } };
  }
  if (
    owner.kind === "worker" && typeof owner.token === "string" && UUID.test(owner.token) &&
    typeof owner.version === "number" && owner.version === value.attemptVersion
  ) {
    return { version: 2, status: "creating", attemptId: value.attemptId, attemptVersion: value.attemptVersion, owner: { kind: "worker", token: owner.token, version: owner.version } };
  }
  return null;
}

async function lockRows(tx: PrismaTypes.TransactionClient, id: number) {
  const customers = await tx.$queryRaw<Array<{ id: number }>>`
    SELECT id FROM GolfClient WHERE id = ${id} FOR UPDATE
  `;
  if (!customers.length) return null;
  const client = await tx.golfClient.findUniqueOrThrow({
    where: { id },
    select: { ghlContactId: true, ghlContactCreationState: true },
  });
  const states = await tx.$queryRaw<Array<{ golfClientId: number }>>`
    SELECT golfClientId FROM GolfClientSyncState WHERE golfClientId = ${id} FOR UPDATE
  `;
  if (!states.length) return { client, state: null };
  const state = await tx.golfClientSyncState.findUniqueOrThrow({ where: { golfClientId: id } });
  return { client, state };
}

function hasAttempt(state: NonNullable<Awaited<ReturnType<typeof lockRows>>>["state"]): boolean {
  return Boolean(state && (
    state.creationAttemptId !== null || state.creationAttemptVersion !== null ||
    state.creationAttemptStatus !== null || state.creationAttemptedAt !== null
  ));
}

/**
 * Reserves a single attempt in a committed transaction. No network request is
 * made here; callers must perform discovery and obtain any required approval.
 */
export async function reserveContactCreation(
  db: PrismaClient,
  input: { golfClientId: number; expectedVersion: number; workerClaim?: CustomerSyncClaim },
): Promise<ReservationResult> {
  const { golfClientId, expectedVersion, workerClaim } = input;
  assertId(golfClientId);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new RangeError("Invalid expected version.");
  if (workerClaim && (
    workerClaim.golfClientId !== golfClientId || workerClaim.version !== expectedVersion || !UUID.test(workerClaim.token)
  )) throw new Error("Invalid worker claim.");
  return db.$transaction(async (tx) => {
    const row = await lockRows(tx, golfClientId);
    if (!row) return { status: "blocked", reason: "customer_missing" };
    const { client, state } = row;
    if (client.ghlContactCreationState !== null || hasAttempt(state)) {
      return { status: "blocked", reason: "attempt_unresolved" };
    }
    if (client.ghlContactId !== null) return { status: "linked", contactId: client.ghlContactId };
    if (!state) return { status: "blocked", reason: "sync_state_missing" };
    if (state.desiredVersion !== expectedVersion || state.syncedVersion > expectedVersion) {
      return { status: "blocked", reason: "version_changed" };
    }
    if (!workerClaim && (
      state.workStatus !== "pending" || state.claimToken !== null ||
      state.claimedVersion !== null || state.leaseExpiresAt !== null
    )) return { status: "blocked", reason: "work_not_available" };

    const id = randomUUID();
    const owner: Owner = workerClaim
      ? { kind: "worker", token: workerClaim.token, version: workerClaim.version }
      : { kind: "standalone" };
    const marker: PrismaTypes.InputJsonObject = {
      version: 2, status: "creating", attemptId: id, attemptVersion: expectedVersion, owner,
    };
    const updated = workerClaim
      ? await tx.$executeRaw`
          UPDATE GolfClientSyncState SET creationAttemptId = ${id},
            creationAttemptVersion = ${expectedVersion}, creationAttemptStatus = 'started',
            creationAttemptedAt = CURRENT_TIMESTAMP(3), updatedAt = CURRENT_TIMESTAMP(3)
          WHERE golfClientId = ${golfClientId} AND workStatus = 'processing'
            AND claimToken = ${workerClaim.token} AND claimedVersion = ${workerClaim.version}
            AND desiredVersion = ${expectedVersion} AND leaseExpiresAt > CURRENT_TIMESTAMP(3)
        `
      : await tx.$executeRaw`
          UPDATE GolfClientSyncState SET creationAttemptId = ${id},
            creationAttemptVersion = ${expectedVersion}, creationAttemptStatus = 'started',
            creationAttemptedAt = CURRENT_TIMESTAMP(3), updatedAt = CURRENT_TIMESTAMP(3)
          WHERE golfClientId = ${golfClientId} AND workStatus = 'pending'
            AND desiredVersion = ${expectedVersion}
        `;
    if (updated !== 1) return { status: "blocked", reason: "worker_claim_lost" };
    await tx.golfClient.update({
      where: { id: golfClientId },
      data: { ghlContactCreationState: marker },
    });
    return { status: "reserved", attempt: { golfClientId, id, version: expectedVersion } };
  }, OPTIONS);
}

class LostAttemptError extends Error {}

type Outcome =
  | { kind: "acknowledged"; contactId: string }
  | { kind: "rejected"; code: string; message: string }
  | { kind: "uncertain"; code: string; message: string };

async function transitionAttempt(
  db: PrismaClient,
  attempt: ContactCreationAttempt,
  outcome: Outcome,
): Promise<AttemptTransitionResult> {
  assertAttempt(attempt);
  if (outcome.kind === "acknowledged" && !isValidGhlContactId(outcome.contactId)) {
    throw new Error("A valid verified GHL contact ID is required.");
  }
  if (outcome.kind !== "acknowledged" && (
    !outcome.code.trim() || outcome.code.length > 64 || !outcome.message.trim()
  )) throw new Error("A valid error code and message are required.");
  try {
    return await db.$transaction(async (tx): Promise<AttemptTransitionResult> => {
      const row = await lockRows(tx, attempt.golfClientId);
      if (!row?.state) return { status: "lost_attempt" };
      const marker = markerFor(row.client.ghlContactCreationState);
      const state = row.state;
      if (
        !marker || marker.attemptId !== attempt.id || marker.attemptVersion !== attempt.version ||
        state.creationAttemptId !== attempt.id || state.creationAttemptVersion !== attempt.version ||
        state.creationAttemptStatus !== "started" || state.creationAttemptedAt === null
      ) return { status: "lost_attempt" };
      if (row.client.ghlContactId !== null) return { status: "contact_conflict" };
      if (marker.owner.kind === "standalone" && (
        state.workStatus !== "pending" || state.claimToken !== null ||
        state.claimedVersion !== null || state.leaseExpiresAt !== null
      )) return { status: "lost_attempt" };

      const profileChanged = outcome.kind === "acknowledged" && state.desiredVersion !== attempt.version;
      const effectiveOutcome: Outcome = profileChanged
        ? { kind: "uncertain", code: "profile_changed", message: "The customer profile changed during contact creation. Reconcile the created contact before linking it." }
        : outcome;
      const owner = marker.owner;
      const status = effectiveOutcome.kind === "acknowledged"
        ? (owner.kind === "worker" ? "processing" : "pending")
        : effectiveOutcome.kind === "rejected" ? "needs_review" : "needs_reconciliation";
      const clear = effectiveOutcome.kind !== "uncertain";
      const code = effectiveOutcome.kind === "acknowledged" ? null : effectiveOutcome.code;
      const message = effectiveOutcome.kind === "acknowledged" ? null : effectiveOutcome.message;
      const updated = owner.kind === "worker"
        ? await tx.$executeRaw`
            UPDATE GolfClientSyncState SET workStatus = ${status},
              creationAttemptId = ${clear ? null : attempt.id},
              creationAttemptVersion = ${clear ? null : attempt.version},
              creationAttemptStatus = ${clear ? null : "unknown"},
              creationAttemptedAt = CASE WHEN ${clear} THEN NULL ELSE creationAttemptedAt END,
              nextAttemptAt = NULL, lastErrorCode = ${code}, lastError = ${message},
              updatedAt = CURRENT_TIMESTAMP(3)
            WHERE golfClientId = ${attempt.golfClientId} AND creationAttemptId = ${attempt.id}
              AND creationAttemptVersion = ${attempt.version} AND creationAttemptStatus = 'started'
              AND workStatus = 'processing' AND claimToken = ${owner.token}
              AND claimedVersion = ${owner.version} AND leaseExpiresAt > CURRENT_TIMESTAMP(3)
          `
        : await tx.$executeRaw`
            UPDATE GolfClientSyncState SET workStatus = ${status},
              creationAttemptId = ${clear ? null : attempt.id},
              creationAttemptVersion = ${clear ? null : attempt.version},
              creationAttemptStatus = ${clear ? null : "unknown"},
              creationAttemptedAt = CASE WHEN ${clear} THEN NULL ELSE creationAttemptedAt END,
              nextAttemptAt = NULL, lastErrorCode = ${code}, lastError = ${message},
              updatedAt = CURRENT_TIMESTAMP(3)
            WHERE golfClientId = ${attempt.golfClientId} AND creationAttemptId = ${attempt.id}
              AND creationAttemptVersion = ${attempt.version} AND creationAttemptStatus = 'started'
              AND workStatus = 'pending' AND claimToken IS NULL AND claimedVersion IS NULL
              AND leaseExpiresAt IS NULL
          `;
      if (updated !== 1) throw new LostAttemptError();
      if (clear) {
        await tx.golfClient.update({
          where: { id: attempt.golfClientId },
          data: {
            ghlContactCreationState: Prisma.DbNull,
            ...(effectiveOutcome.kind === "acknowledged" ? { ghlContactId: effectiveOutcome.contactId } : {}),
          },
        });
      }
      if (owner.kind === "worker") {
        if (effectiveOutcome.kind === "acknowledged") {
          const lease = await tx.$queryRaw<Array<{ valid: number | bigint | null }>>`
            SELECT leaseExpiresAt > CURRENT_TIMESTAMP(3) AS valid
            FROM GolfClientSyncState WHERE golfClientId = ${attempt.golfClientId}
              AND workStatus = 'processing' AND claimToken = ${owner.token}
              AND claimedVersion = ${owner.version}
          `;
          if (Number(lease[0]?.valid) !== 1) throw new LostAttemptError();
        } else {
          const released = await tx.$executeRaw`
            UPDATE GolfClientSyncState SET claimToken = NULL, claimedVersion = NULL,
              leaseExpiresAt = NULL, updatedAt = CURRENT_TIMESTAMP(3)
            WHERE golfClientId = ${attempt.golfClientId} AND workStatus = ${status}
              AND claimToken = ${owner.token} AND claimedVersion = ${owner.version}
              AND leaseExpiresAt > CURRENT_TIMESTAMP(3)
          `;
          if (released !== 1) throw new LostAttemptError();
        }
      }
      return { status: profileChanged ? "needs_reconciliation" : "applied" };
    }, OPTIONS);
  } catch (error) {
    if (error instanceof LostAttemptError) return { status: "lost_attempt" };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { status: "contact_conflict" };
    }
    throw error;
  }
}

/** Call only after the caller has verified the returned contact's identity and location. */
export function acknowledgeContactCreation(db: PrismaClient, attempt: ContactCreationAttempt, contactId: string) {
  return transitionAttempt(db, attempt, { kind: "acknowledged", contactId });
}

/** Use only for a response known not to have created a contact. */
export function rejectContactCreation(db: PrismaClient, attempt: ContactCreationAttempt, code: string, message: string) {
  return transitionAttempt(db, attempt, { kind: "rejected", code, message });
}

export function markContactCreationUncertain(db: PrismaClient, attempt: ContactCreationAttempt, code: string, message: string) {
  return transitionAttempt(db, attempt, { kind: "uncertain", code, message });
}
