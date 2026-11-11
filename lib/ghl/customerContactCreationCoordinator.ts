import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, type Prisma as PrismaTypes } from "@/app/generated/prisma/client";
import type { CustomerSyncClaim } from "./customerSyncWorkerState";
import { isValidGhlContactId } from "@/lib/imports/ghl-contact-approval";

type Owner =
  | { kind: "worker"; token: string; version: number }
  | { kind: "staged"; sessionId: number; batchId: number }
  | { kind: "standalone" };

export interface StagedContactCreationOwner {
  kind: "staged";
  sessionId: number;
  batchId: number;
}

export interface ContactCreationAttempt {
  golfClientId: number;
  id: string;
  version: number;
  owner?: StagedContactCreationOwner;
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

interface StagedSession {
  id: number;
  clientId: number;
  ghlSyncState: PrismaTypes.JsonValue | null;
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
  if (attempt.owner && (
    attempt.owner.kind !== "staged" ||
    !Number.isSafeInteger(attempt.owner.sessionId) || attempt.owner.sessionId < 1 ||
    !Number.isSafeInteger(attempt.owner.batchId) || attempt.owner.batchId < 1
  )) throw new Error("Invalid staged contact creation owner.");
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
  if (
    owner.kind === "staged" &&
    typeof owner.sessionId === "number" &&
    Number.isSafeInteger(owner.sessionId) && owner.sessionId > 0 &&
    typeof owner.batchId === "number" &&
    Number.isSafeInteger(owner.batchId) && owner.batchId > 0
  ) {
    return {
      version: 2,
      status: "creating",
      attemptId: value.attemptId,
      attemptVersion: value.attemptVersion,
      owner: { kind: "staged", sessionId: owner.sessionId, batchId: owner.batchId },
    };
  }
  return null;
}

function stagedSessionState(value: PrismaTypes.JsonValue | null): PrismaTypes.InputJsonObject | null {
  if (value === null) return { version: 1 };
  if (
    typeof value !== "object" || Array.isArray(value) ||
    value.version !== 1
  ) return null;
  return value as PrismaTypes.InputJsonObject;
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

async function lockStagedSession(
  tx: PrismaTypes.TransactionClient,
  golfClientId: number,
  sessionId: number,
): Promise<StagedSession | null> {
  const rows = await tx.$queryRaw<Array<{ id: number }>>`
    SELECT id FROM DemoSession WHERE id = ${sessionId} FOR UPDATE
  `;
  if (!rows.length) return null;
  const session = await tx.demoSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: { id: true, clientId: true, ghlSyncState: true },
  });
  return session.clientId === golfClientId ? session : null;
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

/**
 * Reserves a staged attempt together with its DemoSession marker. The customer,
 * sync-state, and session locks are acquired in that order; no network work is
 * performed in this transaction.
 */
export async function reserveStagedContactCreation(
  db: PrismaClient,
  input: { golfClientId: number; sessionId: number; batchId: number; expectedVersion?: number },
): Promise<ReservationResult> {
  const { golfClientId, sessionId, batchId, expectedVersion } = input;
  assertId(golfClientId);
  assertId(sessionId);
  assertId(batchId);
  if (
    expectedVersion !== undefined &&
    (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
  ) throw new RangeError("Invalid expected version.");

  return db.$transaction(async (tx) => {
    const row = await lockRows(tx, golfClientId);
    if (!row) return { status: "blocked", reason: "customer_missing" };
    const { client } = row;
    if (client.ghlContactCreationState !== null || hasAttempt(row.state)) {
      return { status: "blocked", reason: "attempt_unresolved" };
    }
    if (client.ghlContactId !== null) return { status: "linked", contactId: client.ghlContactId };

    const session = await lockStagedSession(tx, golfClientId, sessionId);
    if (!session) return { status: "blocked", reason: "session_customer_mismatch" };
    const sessionState = stagedSessionState(session.ghlSyncState);
    if (!sessionState || sessionState.contact !== undefined) {
      return { status: "blocked", reason: "session_state_unresolved" };
    }

    let state = row.state;
    if (!state) {
      state = await tx.golfClientSyncState.create({
        data: { golfClientId },
      });
    }
    if (
      state.workStatus !== "pending" ||
      state.claimToken !== null ||
      state.claimedVersion !== null ||
      state.leaseExpiresAt !== null
    ) return { status: "blocked", reason: "work_not_available" };
    if (expectedVersion !== undefined && state.desiredVersion !== expectedVersion) {
      return { status: "blocked", reason: "version_changed" };
    }
    if (
      !Number.isSafeInteger(state.desiredVersion) || state.desiredVersion < 1 ||
      !Number.isSafeInteger(state.syncedVersion) || state.syncedVersion < 0 ||
      state.syncedVersion > state.desiredVersion
    ) {
      return { status: "blocked", reason: "invalid_sync_version" };
    }

    const id = randomUUID();
    const attempt: ContactCreationAttempt = {
      golfClientId,
      id,
      version: state.desiredVersion,
      owner: { kind: "staged", sessionId, batchId },
    };
    const marker: PrismaTypes.InputJsonObject = {
      version: 2,
      status: "creating",
      attemptId: id,
      attemptVersion: state.desiredVersion,
      owner: { kind: "staged", sessionId, batchId },
    };
    const attemptedAt = new Date().toISOString();
    const updated = await tx.$executeRaw`
      UPDATE GolfClientSyncState SET creationAttemptId = ${id},
        creationAttemptVersion = ${state.desiredVersion}, creationAttemptStatus = 'started',
        creationAttemptedAt = CURRENT_TIMESTAMP(3), updatedAt = CURRENT_TIMESTAMP(3)
      WHERE golfClientId = ${golfClientId} AND workStatus = 'pending'
        AND desiredVersion = ${state.desiredVersion}
        AND claimToken IS NULL AND claimedVersion IS NULL AND leaseExpiresAt IS NULL
    `;
    if (updated !== 1) return { status: "blocked", reason: "work_not_available" };
    await tx.golfClient.update({
      where: { id: golfClientId },
      data: { ghlContactCreationState: marker },
    });
    await tx.demoSession.update({
      where: { id: sessionId },
      data: {
        ghlSyncState: {
          ...sessionState,
          contact: {
            status: "creating",
            batchId,
            clientId: golfClientId,
            attemptId: id,
            attemptedAt,
          },
        },
        ghlSyncStatus: "failed",
        ghlSyncError: `GHL contact creation attempt ${id} is reserved for batch ${batchId}; reconcile before retrying.`,
      },
    });
    return { status: "reserved", attempt };
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
      if (marker.owner.kind === "staged") {
        if (
          attempt.owner?.kind !== "staged" ||
          attempt.owner.sessionId !== marker.owner.sessionId ||
          attempt.owner.batchId !== marker.owner.batchId
        ) return { status: "lost_attempt" };
        const session = await lockStagedSession(tx, attempt.golfClientId, marker.owner.sessionId);
        const sessionState = session && stagedSessionState(session.ghlSyncState);
        const sessionContact = sessionState?.contact;
        if (!session || !sessionState ||
          typeof sessionContact !== "object" || sessionContact === null ||
          Array.isArray(sessionContact)) return { status: "lost_attempt" };
        const contact = sessionContact as PrismaTypes.JsonObject;
        if (
          contact.status !== "creating" ||
          contact.clientId !== attempt.golfClientId ||
          contact.batchId !== marker.owner.batchId ||
          contact.attemptId !== attempt.id
        ) return { status: "lost_attempt" };
      } else if (attempt.owner) {
        return { status: "lost_attempt" };
      }
      if (marker.owner.kind === "standalone" && (
        state.workStatus !== "pending" || state.claimToken !== null ||
        state.claimedVersion !== null || state.leaseExpiresAt !== null
      )) return { status: "lost_attempt" };
      if (marker.owner.kind === "staged" && (
        state.workStatus !== "pending" || state.claimToken !== null ||
        state.claimedVersion !== null || state.leaseExpiresAt !== null
      )) return { status: "lost_attempt" };

      const profileChanged = marker.owner.kind !== "staged" &&
        outcome.kind === "acknowledged" && state.desiredVersion !== attempt.version;
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
      if (owner.kind === "staged") {
        const session = await tx.demoSession.findUniqueOrThrow({
          where: { id: owner.sessionId },
          select: { ghlSyncState: true },
        });
        const sessionState = stagedSessionState(session.ghlSyncState);
        if (!sessionState) throw new LostAttemptError();
        const nextState: PrismaTypes.InputJsonObject = effectiveOutcome.kind === "acknowledged"
          ? {
              ...sessionState,
              contact: {
                status: "resolved",
                batchId: owner.batchId,
                clientId: attempt.golfClientId,
                contactId: effectiveOutcome.contactId,
                attemptId: attempt.id,
              },
            }
          : effectiveOutcome.kind === "rejected"
            ? Object.fromEntries(Object.entries(sessionState).filter(([key]) => key !== "contact"))
            : sessionState;
        await tx.demoSession.update({
          where: { id: owner.sessionId },
          data: {
            ghlSyncState: Object.keys(nextState).length === 1
              ? Prisma.DbNull
              : nextState,
            ...(effectiveOutcome.kind === "acknowledged"
              ? { ghlSyncStatus: "contact_resolved", ghlSyncError: null }
              : effectiveOutcome.kind === "rejected"
                ? {
                    ghlSyncStatus: nextState.opportunity ? "failed" : null,
                    ghlSyncError: nextState.opportunity
                      ? effectiveOutcome.message
                      : null,
                  }
                : {
                    ghlSyncStatus: "failed",
                    ghlSyncError: effectiveOutcome.message,
                  }),
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
