import assert from "node:assert/strict";
import { after, test } from "node:test";

test("purchase request writes enqueue a value recalculation and preserve retained snapshots", async () => {
  const originalPrisma = Object.getOwnPropertyDescriptor(globalThis, "prisma");
  after(() => {
    if (originalPrisma) Object.defineProperty(globalThis, "prisma", originalPrisma);
    else Reflect.deleteProperty(globalThis, "prisma");
  });
  const events: unknown[] = [];
  let replacementData: unknown;
  const fake = {
    async $transaction<T>(fn: (tx: never) => Promise<T>) { return fn(fake as never); },
    purchaseRequest: {
      async findUnique({ select }: { select: { items?: unknown } }) {
        return select.items
          ? { id: 8, status: "reviewing", demoSessionId: 7, items: [{ demoClubTestId: 11 }] }
          : { demoSessionId: 7 };
      },
      async update({ data }: { data: unknown }) {
        replacementData = data;
        return { id: 8, status: "reviewing" };
      },
      async create() { return { id: 8 }; },
    },
    demoClubTest: {
      async findMany() {
        return [
          { id: 11, clubType: "Driver", estimatedPrice: 999 },
          { id: 12, clubType: "Wedge", estimatedPrice: 25 },
        ];
      },
    },
    demoSession: {
      async findUniqueOrThrow() { return { ghlOpportunityId: "opp-A" }; },
    },
    ghlSyncEvent: {
      async create({ data }: { data: unknown }) { events.push(data); },
    },
  };
  Object.defineProperty(globalThis, "prisma", { configurable: true, writable: true, value: fake });
  const { createPurchaseRequest, replacePurchaseRequestItems, updatePurchaseRequestStatus } =
    await import("../lib/queries/purchase-requests");

  const replacement = await replacePurchaseRequestItems(8, {
    demoClubTestIds: [11, 12], notes: "Updated",
  });
  assert.equal(replacement.ok, true);
  assert.deepEqual(replacementData, {
    notes: "Updated",
    items: {
      deleteMany: { demoClubTestId: { notIn: [11, 12] } },
      create: [{ demoClubTestId: 12, clubType: "Wedge", estimatedPrice: 25 }],
    },
  });
  const status = await updatePurchaseRequestStatus(8, "closed_lost");
  assert.equal(status?.opportunityId, "opp-A");
  const created = await createPurchaseRequest(1, 7, [
    { demoClubTestId: 11, clubType: "Driver", estimatedPrice: null },
  ]);
  assert.equal(created.opportunityId, "opp-A");
  assert.deepEqual(events, Array.from({ length: 3 }, () => ({
    eventType: "purchase_request_opportunity_value", status: "queued", message: '{"opportunityId":"opp-A"}',
  })));
});
