import assert from "node:assert/strict";
import { after, test } from "node:test";
import { NextRequest } from "next/server";
import { Prisma } from "../app/generated/prisma/client";
import { signStaffSessionToken } from "../lib/auth/session";
import { calculateFittingValue, sumPrices } from "../lib/fitting-value";
import { formatCurrency } from "../lib/format-currency";

test("currency formatting includes cents and thousands separators", () => {
  assert.equal(formatCurrency(0), "$0.00");
  assert.equal(formatCurrency(369.68), "$369.68");
  assert.equal(formatCurrency(1500), "$1,500.00");
  assert.equal(formatCurrency(2457.84), "$2,457.84");
  assert.equal(formatCurrency(2827.52), "$2,827.52");
  assert.equal(formatCurrency(1234567.89), "$1,234,567.89");
});

test("fitting values count included clubs and distinguish missing, partial and zero prices", () => {
  const result = calculateFittingValue([
    { includeInReport: true, estimatedPrice: new Prisma.Decimal("0.10") },
    { includeInReport: true, estimatedPrice: new Prisma.Decimal("0.20") },
    { includeInReport: true, estimatedPrice: null },
    { includeInReport: false, estimatedPrice: new Prisma.Decimal("99") },
  ]);
  assert.deepEqual(result, {
    includedClubCount: 3,
    totalClubCount: 4,
    total: 0.3,
    hasAnyPrice: true,
    hasPartialPrice: true,
    hasMissingPrices: true,
  });
  assert.deepEqual(calculateFittingValue([
    { includeInReport: true, estimatedPrice: new Prisma.Decimal("0.00") },
  ]), {
    includedClubCount: 1, totalClubCount: 1, total: 0,
    hasAnyPrice: true, hasPartialPrice: false, hasMissingPrices: false,
  });
  const missing = calculateFittingValue([{ includeInReport: true, estimatedPrice: null }]);
  assert.equal(missing.total, 0);
  assert.equal(missing.hasAnyPrice, false);
  assert.equal(missing.hasPartialPrice, false);
  assert.equal(missing.hasMissingPrices, true);
  const zeroPartial = calculateFittingValue([
    { includeInReport: true, estimatedPrice: new Prisma.Decimal("0.00") },
    { includeInReport: true, estimatedPrice: null },
  ]);
  assert.equal(zeroPartial.hasAnyPrice, true);
  assert.equal(zeroPartial.hasPartialPrice, true);
  assert.equal(sumPrices([new Prisma.Decimal("0.10"), new Prisma.Decimal("0.20")]), 0.3);
});

test("opportunity API returns independent local values even when GHL is unavailable", async () => {
  const originalPrisma = Object.getOwnPropertyDescriptor(globalThis, "prisma");
  const originalFetch = globalThis.fetch;
  const originalSecret = process.env.SESSION_SECRET;
  const originalToken = process.env.GHL_SWINGLOCKER_PRIVATE_TOKEN;
  const originalStage = process.env.GHL_SWINGLOCKER_STAGE_DEMO_SUBMITTED_ID;
  process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-characters";
  process.env.GHL_SWINGLOCKER_PRIVATE_TOKEN = "test-only-token";
  process.env.GHL_SWINGLOCKER_STAGE_DEMO_SUBMITTED_ID = "test-stage";
  after(() => {
    if (originalPrisma) Object.defineProperty(globalThis, "prisma", originalPrisma);
    else Reflect.deleteProperty(globalThis, "prisma");
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries({
      SESSION_SECRET: originalSecret,
      GHL_SWINGLOCKER_PRIVATE_TOKEN: originalToken,
      GHL_SWINGLOCKER_STAGE_DEMO_SUBMITTED_ID: originalStage,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const club = (price: string | null, included = true) => ({
    id: 1, includeInReport: included,
    estimatedPrice: price === null ? null : new Prisma.Decimal(price),
  });
  const session = (id: number, status: string, clubs: ReturnType<typeof club>[]) => ({
    id, status, needsRefinalization: id === 31, demoDate: new Date("2026-01-01T00:00:00Z"),
    currentClub: null, clientGoal: null, notes: null,
    client: { firstName: "Test", lastName: "Customer", email: null, phone: null },
    importBatches: [{ id, status: "approved", rowCount: 3, clubSummaries: clubs }],
    purchaseRequests: [],
  });
  const sessions = [
    session(26, "finalized", [club(null)]),
    session(31, "finalized", [club("14.00"), club("99.00", false)]),
    session(32, "reviewing", [club("500.00")]),
  ];
  const request = (id: number, status: string, price: string | null, demoSessionId = 31) => ({
    id, status, demoSessionId, createdAt: new Date("2026-01-02T00:00:00Z"),
    items: [{ estimatedPrice: price === null ? null : new Prisma.Decimal(price) }],
  });
  let requests = [
    request(1, "new_request", "0.10"),
    request(2, "reviewing", "0.20", 26),
    request(3, "quote_sent", "1.00"),
    request(4, "purchased", "2.00"),
    request(5, "fulfilled", "3.00"),
    request(6, "closed_lost", "100.00"),
    request(7, "cancelled", "100.00"),
    request(8, "fulfilled", null),
  ];
  Object.defineProperty(globalThis, "prisma", {
    configurable: true,
    writable: true,
    value: {
      demoSession: {
        async findMany(query: { where: { ghlOpportunityId: string }; take?: number; select: { importBatches: { take: number; orderBy: { createdAt: string }; select: { clubSummaries: { select: { includeInReport: boolean; estimatedPrice: boolean } } } } } }) {
          assert.deepEqual(query.where, { ghlOpportunityId: "opp-test" });
          assert.equal(query.take, undefined);
          assert.equal(query.select.importBatches.take, 1);
          assert.deepEqual(query.select.importBatches.orderBy, { createdAt: "desc" });
          assert.equal(query.select.importBatches.select.clubSummaries.select.includeInReport, true);
          assert.equal(query.select.importBatches.select.clubSummaries.select.estimatedPrice, true);
          return sessions;
        },
      },
      purchaseRequest: {
        async findMany(query: { where: { demoSession: { ghlOpportunityId: string } } }) {
          assert.deepEqual(query.where, { demoSession: { ghlOpportunityId: "opp-test" } });
          return requests;
        },
      },
    },
  });

  let available = false;
  let fetches = 0;
  globalThis.fetch = async (input, init) => {
    fetches++;
    assert.equal(String(input), "https://services.leadconnectorhq.com/opportunities/opp-test");
    assert.equal(init?.method, "GET");
    assert.ok(init?.signal instanceof AbortSignal);
    return available
      ? Response.json({ opportunity: { pipelineStageId: "test-stage", monetaryValue: 999 } })
      : new Response("unavailable", { status: 503 });
  };
  const { GET } = await import("../app/api/staff/opportunities/[id]/route");
  const token = signStaffSessionToken({ staffUserId: 1, expiresAt: Date.now() + 60_000 });
  const getResponse = () => GET(
    new NextRequest("http://localhost/api/staff/opportunities/opp-test", {
      headers: { cookie: `staff_session=${token}` },
    }),
    { params: Promise.resolve({ id: "opp-test" }) },
  );

  const response = await getResponse();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ghl.unavailable, true);
  assert.equal(body.estimatedOpportunityValue, 14);
  assert.equal(body.estimatedOpportunityHasMissingPrices, true);
  assert.equal(body.purchaseRequestValue, 6.3);
  assert.equal(body.sessions[0].fittingValue.hasAnyPrice, false);
  assert.equal(body.sessions[1].fittingValue.total, 14);
  assert.equal(body.sessions[1].fittingValue.includedClubCount, 1);
  assert.equal(body.sessions[1].fittingValue.totalClubCount, 2);
  assert.equal(body.sessions[2].fittingValue.total, 500);
  assert.equal(body.purchaseRequests[0].subtotal, 0.1);
  assert.equal(typeof body.sessions[1].fittingValue.total, "number");
  assert.equal(typeof body.purchaseRequestValue, "number");

  available = true;
  requests = [];
  const availableBody = await (await getResponse()).json();
  assert.equal(availableBody.ghl.stage, "demo");
  assert.equal(availableBody.ghl.monetaryValue, 999);
  assert.equal(availableBody.estimatedOpportunityValue, 14);
  assert.equal(availableBody.purchaseRequestValue, 0);

  sessions.push(session(33, "finalized", [club("0.10"), club("0.20")]));
  const cumulativeBody = await (await getResponse()).json();
  assert.equal(cumulativeBody.estimatedOpportunityValue, 14.3);
  assert.equal(fetches, 3);
});
