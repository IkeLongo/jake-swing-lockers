import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { sumPrices } from "@/lib/fitting-value";
import { PURCHASE_REQUEST_VALUE_STATUSES } from "@/lib/purchase-request-status";

export async function getClientPurchaseRequestValues(clientId?: number): Promise<Map<number, number>> {
  const clientFilter = clientId === undefined
    ? Prisma.empty
    : Prisma.sql`AND s.clientId = ${clientId}`;
  const rows = await db.$queryRaw<{ clientId: number; total: Prisma.Decimal }[]>(Prisma.sql`
    SELECT s.clientId, COALESCE(SUM(i.estimatedPrice), 0) AS total
    FROM PurchaseRequestItem i
    JOIN PurchaseRequest r ON r.id = i.purchaseRequestId
    JOIN DemoSession s ON s.id = r.demoSessionId
    WHERE r.status IN (${Prisma.join(PURCHASE_REQUEST_VALUE_STATUSES)})
      ${clientFilter}
    GROUP BY s.clientId
  `);
  return new Map(rows.map((row) => [row.clientId, sumPrices([row.total])]));
}
