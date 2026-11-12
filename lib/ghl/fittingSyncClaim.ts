import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@/app/generated/prisma/client";
import { hasUnresolvedFittingSyncState } from "./syncErrorMarker";

function sessionState(value: unknown): Prisma.JsonObject {
  if (value === null) return { version: 1 };
  if (typeof value !== "object" || Array.isArray(value) || (value as Record<string, unknown>).version !== 1) {
    throw new Error("The fitting sync state requires reconciliation.");
  }
  return value as Prisma.JsonObject;
}

function rawSessionState(value: Prisma.JsonValue): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export async function claimFittingSync(
  db: PrismaClient,
  sessionId: number,
  expectedClientId?: number,
): Promise<string | null> {
  const token = randomUUID();
  return db.$transaction(async (tx) => {
    const target = await tx.demoSession.findUnique({
      where: { id: sessionId },
      select: { clientId: true },
    });
    if (!target || (expectedClientId !== undefined && target.clientId !== expectedClientId)) return null;
    const customers = await tx.$queryRaw<{ id: number }[]>`
      SELECT id FROM GolfClient WHERE id = ${target.clientId} FOR UPDATE
    `;
    if (!customers.length) return null;
    const sessions = await tx.$queryRaw<{ id: number; ghlSyncState: Prisma.JsonValue }[]>`
      SELECT id, ghlSyncState FROM DemoSession
      WHERE clientId = ${target.clientId} ORDER BY id FOR UPDATE
    `;
    const session = sessions.find((row) => row.id === sessionId);
    if (!session || sessions.some((row) => hasUnresolvedFittingSyncState(rawSessionState(row.ghlSyncState)))) return null;
    const state = sessionState(rawSessionState(session.ghlSyncState));
    await tx.demoSession.update({
      where: { id: sessionId },
      data: {
        ghlSyncState: {
          ...state,
          fittingClaim: { token, claimedAt: new Date().toISOString() },
        } as Prisma.InputJsonObject,
      },
    });
    return token;
  });
}

export async function releaseFittingSync(
  db: PrismaClient,
  sessionId: number,
  token: string,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: number }[]>`
      SELECT id FROM DemoSession WHERE id = ${sessionId} FOR UPDATE
    `;
    if (!rows.length) throw new Error("The claimed fitting no longer exists.");
    const session = await tx.demoSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { ghlSyncState: true },
    });
    const state = sessionState(session.ghlSyncState);
    const claim = state.fittingClaim;
    if (
      !claim || typeof claim !== "object" || Array.isArray(claim) ||
      claim.token !== token
    ) {
      throw new Error("The fitting sync claim changed; reconciliation is required.");
    }
    const rest = { ...state };
    delete rest.fittingClaim;
    if (hasUnresolvedFittingSyncState(rest)) return false;
    await tx.demoSession.update({
      where: { id: sessionId },
      data: {
        ghlSyncState: Object.keys(rest).length === 1
          ? Prisma.DbNull
          : rest as Prisma.InputJsonObject,
      },
    });
    return true;
  });
}
