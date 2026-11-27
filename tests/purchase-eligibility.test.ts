import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { Prisma } from "../app/generated/prisma/client";
import { signStaffSessionToken } from "../lib/auth/session";
import { signSwingLockerSessionToken } from "../lib/auth/swing-locker-session";

test("staff eligibility requires inclusion and customer requests reject ineligible clubs", async (t) => {
  const originalPrisma = Object.getOwnPropertyDescriptor(globalThis, "prisma");
  const originalSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-characters";
  t.after(() => {
    if (originalPrisma) Object.defineProperty(globalThis, "prisma", originalPrisma);
    else Reflect.deleteProperty(globalThis, "prisma");
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
  });
  const summary = { id: 2, importBatchId: 1, includeInReport: true, availableForPurchase: false };
  let needsRefinalization = false;
  const tx = {
      importClubSummary: {
        async findFirst() { return { ...summary }; },
        async update({ where, data }: {
          where: { includeInReport?: boolean };
          data: Partial<typeof summary>;
        }) {
          if (where.includeInReport && !summary.includeInReport) {
            throw new Prisma.PrismaClientKnownRequestError("Not found", { code: "P2025", clientVersion: "test" });
          }
          Object.assign(summary, data);
          return { ...summary };
        },
      },
      importBatch: { async findUnique() { return { demoSessionId: 31 }; } },
      demoSession: {
        async findFirst() { return { id: 31 }; },
        async updateMany({ where, data }: { where: { id: number; status: string }; data: { needsRefinalization: boolean } }) {
          assert.equal(where.id, 31);
          assert.equal(where.status, "finalized");
          needsRefinalization = data.needsRefinalization;
          return { count: 1 };
        },
      },
  };
  const prisma = {
      ...tx,
      demoClubTest: {
        async findMany({ where }: { where: { availableForPurchase: boolean; demoSessionId: number } }) {
          assert.equal(where.availableForPurchase, true);
          assert.equal(where.demoSessionId, 31);
          return [];
        },
      },
    async $transaction(fn: (client: typeof tx) => Promise<unknown>) { return fn(tx); },
  };
  Object.defineProperty(globalThis, "prisma", {
    configurable: true,
    writable: true,
    value: prisma,
  });
  const { PATCH } = await import("../app/api/staff/imports/[id]/club-summaries/[summaryId]/route");
  const token = signStaffSessionToken({ staffUserId: 1, expiresAt: Date.now() + 60_000 });
  const patch = (body: object) => PATCH(new NextRequest("http://localhost/api/staff/imports/1/club-summaries/2", {
    method: "PATCH",
    headers: { cookie: `staff_session=${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: "1", summaryId: "2" }) });

  assert.equal((await patch({ availableForPurchase: true })).status, 200);
  assert.equal(summary.availableForPurchase, true);
  assert.equal(needsRefinalization, true);
  needsRefinalization = false;
  assert.equal((await patch({ includeInReport: false })).status, 200);
  assert.equal(summary.availableForPurchase, false);
  assert.equal(needsRefinalization, true);
  needsRefinalization = false;
  assert.equal((await patch({ availableForPurchase: true })).status, 422);
  assert.equal(summary.availableForPurchase, false);
  assert.equal(needsRefinalization, false);
  assert.equal((await patch({ includeInReport: true, availableForPurchase: true })).status, 200);
  assert.equal(summary.availableForPurchase, true);
  for (const edit of [{ estimatedPrice: 425 }, { clubName: "Driver", tags: ["Stiff"] }, { avgCarry: 200 }]) {
    needsRefinalization = false;
    assert.equal((await patch(edit)).status, 200);
    assert.equal(needsRefinalization, true);
  }
  const { POST } = await import("../app/api/swing-locker/purchase-requests/route");
  const customerToken = signSwingLockerSessionToken({ golfClientId: 7, expiresAt: Date.now() + 60_000 });
  const response = await POST(new NextRequest("http://localhost/api/swing-locker/purchase-requests", {
    method: "POST",
    headers: { cookie: `swing_locker_session=${customerToken}`, "content-type": "application/json" },
    body: JSON.stringify({ demoSessionId: 31, clubIds: [9] }),
  }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /not available for purchase/);
});
