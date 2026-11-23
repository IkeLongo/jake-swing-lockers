import { Prisma, type PrismaClient } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { isDefiniteGhlNoMutation } from "./client";
import { updateGolfDemoOpportunity } from "./opportunities";

const EVENT_TYPE = "purchase_request_opportunity_value";

export async function enqueuePurchaseRequestOpportunityValue(
  tx: Prisma.TransactionClient,
  demoSessionId: number,
): Promise<string | null> {
  const session = await tx.demoSession.findUniqueOrThrow({
    where: { id: demoSessionId },
    select: { ghlOpportunityId: true },
  });
  if (!session.ghlOpportunityId) return null;

  await tx.ghlSyncEvent.create({
    data: {
      eventType: EVENT_TYPE,
      status: "queued",
      message: JSON.stringify({ opportunityId: session.ghlOpportunityId }),
    },
  });
  return session.ghlOpportunityId;
}

export interface OpportunityValueSyncDeps {
  claim(opportunityId: string): Promise<
    | { status: "claimed"; eventId: number }
    | { status: "busy" }
    | { status: "empty" }
  >;
  calculate(opportunityId: string): Promise<number | null>;
  recordValue(eventId: number, opportunityId: string, value: number): Promise<void>;
  update(opportunityId: string, value: number): Promise<void>;
  finish(eventId: number, status: "success" | "failed"): Promise<void>;
}

export function createOpportunityValueSyncDeps(client: PrismaClient): OpportunityValueSyncDeps {
  return {
    claim: (opportunityId) => client.$transaction(async (tx) => {
      // All writers for the same opportunity lock the same associated sessions.
      const sessions = await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM DemoSession
        WHERE BINARY ghlOpportunityId = BINARY ${opportunityId}
        ORDER BY id FOR UPDATE
      `;
      if (sessions.length === 0) {
        throw new Error("No local fitting is linked to the GHL opportunity.");
      }
      const events = await tx.$queryRaw<{ id: number; status: string; message: string | null }[]>`
        SELECT id, status, message FROM GhlSyncEvent
        WHERE eventType = ${EVENT_TYPE}
          AND status IN ('queued', 'pending')
          AND (
            COALESCE(JSON_TYPE(JSON_EXTRACT(
              CASE WHEN JSON_VALID(message) THEN message ELSE '{}' END, '$.opportunityId'
            )), '') <> 'STRING'
            OR JSON_UNQUOTE(JSON_EXTRACT(
              CASE WHEN JSON_VALID(message) THEN message ELSE '{}' END, '$.opportunityId'
            )) = ''
            OR BINARY JSON_UNQUOTE(JSON_EXTRACT(
              CASE WHEN JSON_VALID(message) THEN message ELSE '{}' END, '$.opportunityId'
            )) = BINARY ${opportunityId}
          )
        ORDER BY id FOR UPDATE
      `;
      for (const event of events) {
        if (!event.message) throw new Error("An opportunity value sync event requires reconciliation.");
        const message: unknown = JSON.parse(event.message);
        if (!message || typeof message !== "object" || !("opportunityId" in message) ||
            typeof message.opportunityId !== "string" || !message.opportunityId) {
          throw new Error("An opportunity value sync event requires reconciliation.");
        }
      }
      if (events.some((event) => event.status === "pending")) {
        return { status: "busy" as const };
      }
      const next = events.find((event) => event.status === "queued");
      if (!next) return { status: "empty" as const };
      await tx.ghlSyncEvent.update({
        where: { id: next.id },
        data: { status: "pending" },
      });
      return { status: "claimed" as const, eventId: next.id };
    }, { maxWait: 10_000, timeout: 30_000 }),
    calculate: async (opportunityId) => {
      const rows = await client.$queryRaw<{ requestCount: bigint; total: Prisma.Decimal }[]>`
        SELECT COUNT(DISTINCT r.id) AS requestCount,
          COALESCE(SUM(i.estimatedPrice), 0) AS total
        FROM PurchaseRequest r
        JOIN DemoSession s ON s.id = r.demoSessionId
        LEFT JOIN PurchaseRequestItem i ON i.purchaseRequestId = r.id
        WHERE BINARY s.ghlOpportunityId = BINARY ${opportunityId}
          AND r.status IN ('new_request', 'reviewing', 'quote_sent', 'purchased', 'fulfilled')
      `;
      const row = rows[0];
      if (!row) throw new Error("Could not calculate the opportunity value.");
      if (Number(row.requestCount) === 0) return null;
      const total = Number(row.total);
      if (!Number.isFinite(total) || !Number.isSafeInteger(Math.round(total * 100))) {
        throw new Error("The opportunity value cannot be represented safely.");
      }
      return total;
    },
    recordValue: async (eventId, opportunityId, value) => {
      const result = await client.ghlSyncEvent.updateMany({
        where: { id: eventId, eventType: EVENT_TYPE, status: "pending" },
        data: { message: JSON.stringify({ opportunityId, value }) },
      });
      if (result.count !== 1) throw new Error("The opportunity value sync claim changed.");
    },
    update: (opportunityId, value) =>
      updateGolfDemoOpportunity(opportunityId, { monetaryValue: value }, AbortSignal.timeout(10_000)),
    finish: async (eventId, status) => {
      const result = await client.ghlSyncEvent.updateMany({
        where: { id: eventId, eventType: EVENT_TYPE, status: "pending" },
        data: { status },
      });
      if (result.count !== 1) throw new Error("The opportunity value sync claim changed.");
    },
  };
}

export async function drainPurchaseRequestOpportunityValue(
  opportunityId: string,
  deps: OpportunityValueSyncDeps = createOpportunityValueSyncDeps(db),
): Promise<"synced" | "queued"> {
  for (;;) {
    const claim = await deps.claim(opportunityId);
    if (claim.status === "busy") return "queued";
    if (claim.status === "empty") return "synced";

    let writeStarted = false;
    try {
      const value = await deps.calculate(opportunityId);
      if (value !== null) {
        await deps.recordValue(claim.eventId, opportunityId, value);
        writeStarted = true;
        await deps.update(opportunityId, value);
      }
    } catch (error) {
      if (!writeStarted || isDefiniteGhlNoMutation(error)) {
        await deps.finish(claim.eventId, "failed");
      }
      throw error;
    }
    await deps.finish(claim.eventId, "success");
  }
}
