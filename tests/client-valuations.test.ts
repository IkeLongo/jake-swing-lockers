import assert from "node:assert/strict";
import { after, test } from "node:test";
import React from "react";
import { Prisma } from "../app/generated/prisma/client";
import { formatCurrency } from "../lib/format-currency";

test("client listing and detail use all local fitting and purchase request values", async () => {
  const originalPrisma = Object.getOwnPropertyDescriptor(globalThis, "prisma");
  const originalFetch = globalThis.fetch;
  after(() => {
    if (originalPrisma) Object.defineProperty(globalThis, "prisma", originalPrisma);
    else Reflect.deleteProperty(globalThis, "prisma");
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => { throw new Error("Unexpected external request"); };

  const decimal = (value: string | null) => value === null ? null : new Prisma.Decimal(value);
  const fitting = (id: number, status: string, prices: Array<[string | null, boolean]>) => ({
    id, status, demoDate: new Date("2026-01-01T00:00:00Z"),
    importBatches: [{
      id, clubSummaries: prices.map(([price, included]) => ({
        includeInReport: included, estimatedPrice: decimal(price),
      })),
    }],
  });
  const client = {
    id: 1, firstName: "Test", lastName: "Client", email: null, phone: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    demoSessions: [
      fitting(1, "finalized", [["1000.10", true], ["500", false]]),
      fitting(2, "finalized", [["0.20", true], [null, true]]),
      fitting(3, "reviewing", [["9000", true]]),
    ],
  };
  const sessions = [
    { id: 1, clientId: 1, opportunityId: "opportunity-a" },
    { id: 2, clientId: 1, opportunityId: "opportunity-b" },
    { id: 3, clientId: 1, opportunityId: null },
    { id: 4, clientId: 2, opportunityId: null },
  ];
  const requests = [
    { id: 1, sessionId: 1, status: "new_request", prices: ["12.34", "12.34", null] },
    { id: 2, sessionId: 2, status: "reviewing", prices: ["0.10"] },
    { id: 3, sessionId: 2, status: "quote_sent", prices: ["0.20"] },
    { id: 4, sessionId: 3, status: "purchased", prices: ["1000.00"] },
    { id: 5, sessionId: 3, status: "fulfilled", prices: [null] },
    { id: 6, sessionId: 1, status: "closed_lost", prices: ["200.00"] },
    { id: 7, sessionId: 1, status: "cancelled", prices: ["300.00"] },
  ];

  let queries = 0;
  let listingQueries = 0;
  Object.defineProperty(globalThis, "prisma", {
    configurable: true,
    writable: true,
    value: {
      golfClient: {
        async findMany() {
          listingQueries++;
          return [
            { ...client, _count: { demoSessions: 3 } },
            { ...client, id: 2, firstName: "Empty", demoSessions: [], _count: { demoSessions: 0 } },
          ];
        },
        async findUnique(query: { where: { id: number }; select: { demoSessions: { take?: number; select: { importBatches: { take: number; orderBy: { createdAt: string } } } } } }) {
          assert.equal(query.where.id, 1);
          assert.equal(query.select.demoSessions.take, undefined);
          assert.equal(query.select.demoSessions.select.importBatches.take, 1);
          assert.deepEqual(query.select.demoSessions.select.importBatches.orderBy, { createdAt: "desc" });
          return client;
        },
      },
      async $queryRaw(query: Prisma.Sql) {
        queries++;
        assert.match(query.sql, /FROM PurchaseRequestItem i\s+JOIN PurchaseRequest r ON r\.id = i\.purchaseRequestId\s+JOIN DemoSession s ON s\.id = r\.demoSessionId/);
        assert.match(query.sql, /GROUP BY s\.clientId/);
        assert.doesNotMatch(query.sql, /DISTINCT|ghlOpportunityId|golfClientId/);
        assert.deepEqual(query.values.slice(0, 5), [
          "new_request", "reviewing", "quote_sent", "purchased", "fulfilled",
        ]);
        const clientId = query.values[5];
        if (clientId !== undefined) assert.match(query.sql, /AND s\.clientId = \?/);
        const totals = new Map<number, Prisma.Decimal>();
        for (const request of requests) {
          const session = sessions.find((row) => row.id === request.sessionId);
          assert.ok(session);
          if (!query.values.slice(0, 5).includes(request.status)) continue;
          if (clientId !== undefined && session.clientId !== clientId) continue;
          const total = request.prices.reduce<Prisma.Decimal>(
            (sum, price) => price === null ? sum : sum.plus(price),
            totals.get(session.clientId) ?? new Prisma.Decimal(0),
          );
          totals.set(session.clientId, total);
        }
        return [...totals].map(([id, total]) => ({ clientId: id, total }));
      },
    },
  });

  const { getClientPurchaseRequestValues } = await import("../lib/queries/client-values");
  assert.equal((await getClientPurchaseRequestValues()).get(1), 1024.98);
  assert.equal((await getClientPurchaseRequestValues(2)).get(2) ?? 0, 0);

  const { default: StaffClientsPage } = await import("../app/staff/(protected)/clients/page");
  const listing = await StaffClientsPage();
  const nodes = (node: React.ReactNode): React.ReactNode[] => {
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return [node];
    return [node, ...nodes(node.props.children)];
  };
  const table = nodes(listing).find((node) =>
    React.isValidElement<{ initialClients?: unknown }>(node) && Array.isArray(node.props.initialClients),
  );
  assert.ok(React.isValidElement<{ initialClients: Array<{ id: number; purchaseRequestValue: number }> }>(table));
  assert.deepEqual(table.props.initialClients.map((row) => [row.id, row.purchaseRequestValue]), [
    [1, 1024.98], [2, 0],
  ]);
  assert.equal(listingQueries, 1);
  assert.equal(queries, 3);

  const { default: ClientDetailPage } = await import("../app/staff/(protected)/clients/[id]/page");
  const detail = await ClientDetailPage({ params: Promise.resolve({ id: "1" }) });
  const detailText = nodes(detail).filter((node) => typeof node === "string");
  assert.ok(detailText.includes("Total Estimated Value"));
  assert.ok(detailText.includes(formatCurrency(1000.3)));
  assert.ok(detailText.includes("Total Purchase Request Value"));
  assert.ok(detailText.includes(formatCurrency(1024.98)));
  assert.equal(queries, 4);
});
