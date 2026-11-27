import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { NextFetchEvent } from "next/dist/server/web/spec-extension/fetch-event";
import { RequestCookiesAdapter } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import { Prisma } from "../app/generated/prisma/client";
import { signStaffSessionToken } from "../lib/auth/session";
import { signSwingLockerSessionToken } from "../lib/auth/swing-locker-session";
import { flattenPlan, planComparisonGroups } from "../lib/imports/finalizationPlan";
import { buildApprovedShotSnapshot } from "../lib/imports/approvedShotSnapshot";
import { createTrackManMeasuredShot } from "../lib/imports/trackmanMeasurements";
import { buildCustomerShotFlights } from "../lib/golf/flight/customerShotFlights";
import { toGolfShotVizFlights } from "../lib/golf/flight/golfShotVizAdapter";
import type { CustomerClub, CustomerDemoClub, CustomerSessionDetail } from "../lib/queries/customer-sessions";
import { FittingPresentation } from "../app/swing-locker/_components/FittingPresentation";
import { buildCustomerGapping, ExplorePerformance, linkedDispersionClubs } from "../app/swing-locker/_components/ExplorePerformance";

const nextHeaders: typeof import("next/headers") =
  createRequire(resolve("tests", "shared-fitting-presentation.test.ts"))("next/headers");

test("customer and staff share finalized fitting data without preview mutations", async (t) => {
  const originalPrisma = Object.getOwnPropertyDescriptor(globalThis, "prisma");
  const originalSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-characters";
  t.after(() => {
    if (originalPrisma) Object.defineProperty(globalThis, "prisma", originalPrisma);
    else Reflect.deleteProperty(globalThis, "prisma");
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
  });

  const decimal = (value: string) => new Prisma.Decimal(value);
  const measurements = {
    carryYd: 210, carrySideYd: -3, apexDistanceYd: 100, apexHeightYd: 25,
    apexSideYd: null, launchAngleDeg: 0, launchDirectionDeg: -2,
    landingAngleDeg: 40, totalYd: 230, totalSideYd: 0,
  };
  const snapshot = (rowId: number, carryYd = 210) => ({
    version: 1,
    sourceBatchId: 99,
    sourceSummaryId: 98,
    shots: [{
      sourceRowId: rowId,
      rawData: "not customer-visible",
      lateralSignConvention: "unknown",
      measurements: { ...measurements, carryYd, rawData: "not customer-visible" },
    }],
  });
  const club = (id: number, clubRole: string, clubType: string, pairIndex: number) => ({
    id, clubRole, clubType, pairIndex, currentClubTestId: null as number | null,
    brand: null as string | null, model: null as string | null,
    shaft: null as string | null, loft: null as string | null,
    estimatedPrice: null as Prisma.Decimal | null,
    includeInReport: null as boolean | null,
    availableForPurchase: false,
    tags: [] as string[],
    approvedShotSnapshot: null as Prisma.JsonValue,
    metrics: {
      clubSpeed: decimal("90"), ballSpeed: decimal("130"),
      smashFactor: decimal("1.44"), spinRate: 2500,
      carryDistance: decimal("210"), totalDistance: decimal("230"),
      avgMaxHeight: decimal("30") as Prisma.Decimal | null,
      launchAngle: decimal("12"), dispersion: decimal("8"),
    },
  });
  const current = {
    ...club(10, "current", "Current Driver", 0),
    brand: "Current Brand",
    tags: ["Used"],
    includeInReport: false,
    approvedShotSnapshot: snapshot(100, 190) as Prisma.JsonValue,
  };
  const demo = {
    ...club(11, "demo", "Included Driver", 0),
    currentClubTestId: current.id,
    shaft: "Regular",
    tags: ["Stiff"],
    includeInReport: true,
    estimatedPrice: decimal("299.75"),
    availableForPurchase: true,
    approvedShotSnapshot: snapshot(101) as Prisma.JsonValue,
  };
  const otherCurrent = {
    ...club(12, "current", "Unrelated Current", 1),
    includeInReport: false,
    approvedShotSnapshot: snapshot(102) as Prisma.JsonValue,
  };
  const finalizedPlan = flattenPlan(planComparisonGroups([
    { id: 10, clubName: "Current Driver", tags: [], includeInReport: false, currentSummaryId: null },
    { id: 11, clubName: "Included Driver", tags: [], includeInReport: true, currentSummaryId: 10 },
    { id: 13, clubName: "Excluded Driver", tags: [], includeInReport: false, currentSummaryId: 10 },
  ]));
  assert.deepEqual(finalizedPlan.map((row) => row.summary.id), [10, 11]);
  const finalizedClubs = new Map<number, ReturnType<typeof club>>([[10, current], [11, demo]]);
  const session = {
    id: 31, clientId: 7, status: "finalized",
    demoDate: new Date("2026-04-15T00:00:00.000Z"),
    client: { firstName: "Alex", lastName: "Golfer" },
    notes: "Existing session note",
    clubTests: [...finalizedPlan.map((row) => finalizedClubs.get(row.summary.id)!), otherCurrent],
  };
  const otherSession = { ...session, id: 32, clubTests: [demo] };
  const draft = { ...session, id: 33, status: "draft" };
  const otherCustomer = { ...session, id: 34, clientId: 8 };
  const sessions = [session, otherSession, draft, otherCustomer];
  let hasRequest = false;
  let cookieReads = 0;
  let cookie = "";
  let networkCalls = 0;
  const queries: Array<{ id: number; clientId?: number; status?: string }> = [];
  Object.defineProperty(globalThis, "prisma", {
    configurable: true,
    writable: true,
    value: {
      demoSession: {
        async findFirst(args: {
          where: { id: number; clientId?: number; status?: string };
          select: { clientId?: boolean; clubTests?: { select: {
            approvedShotSnapshot?: boolean;
            includeInReport?: boolean;
            metrics?: { select: { avgMaxHeight?: boolean } };
          } } };
        }) {
          queries.push(args.where);
          const found = sessions.find((row) =>
            row.id === args.where.id &&
            (args.where.clientId === undefined || row.clientId === args.where.clientId) &&
            (args.where.status === undefined || row.status === args.where.status),
          );
          if (!found) return null;
          if (args.select.clientId) return { clientId: found.clientId };
          assert.equal(args.select.clubTests?.select.approvedShotSnapshot, true);
          assert.equal(args.select.clubTests?.select.includeInReport, true);
          assert.equal(args.select.clubTests?.select.metrics?.select.avgMaxHeight, true);
          return found;
        },
        async findMany(args: { where: { clientId: number; status: string } }) {
          return sessions
            .filter((row) => row.clientId === args.where.clientId && row.status === args.where.status)
            .map((row) => ({
              id: row.id, demoDate: row.demoDate, status: row.status,
              clubTests: row.clubTests.filter((item) => item.clubRole === "demo"),
            }));
        },
      },
      golfClient: {
        async findUnique() { return { firstName: "Alex", lastName: "Golfer", email: null }; },
      },
      purchaseRequest: {
        async findFirst(args: { where: { golfClientId: number; demoSessionId: number } }) {
          assert.equal(args.where.golfClientId, 7);
          return hasRequest && args.where.demoSessionId === 31
            ? { id: 50, status: "new_request", createdAt: new Date() }
            : null;
        },
      },
    },
  });
  t.mock.method(nextHeaders, "cookies", async () => {
    cookieReads++;
    const request = new NextRequest("http://localhost", { headers: { cookie } });
    return RequestCookiesAdapter.seal(request.cookies);
  });
  t.mock.method(globalThis, "fetch", async () => {
    networkCalls++;
    throw new Error("Unexpected external request");
  });

  const { getCustomerSession } = await import("../lib/queries/customer-sessions");
  const { default: CustomerPage } = await import("../app/swing-locker/dashboard/sessions/[id]/page");
  const { default: Dashboard } = await import("../app/swing-locker/dashboard/page");
  const { default: PreviewPage } = await import("../app/staff/(protected)/demo-sessions/[id]/preview-locker/page");
  const { FittingPresentation } = await import("../app/swing-locker/_components/FittingPresentation");
  const { PurchaseRequestTrigger } = await import("../app/swing-locker/dashboard/sessions/[id]/_components/PurchaseRequestTrigger");
  const { proxy } = await import("../proxy");

  const fitting = await getCustomerSession(7, 31);
  assert.ok(fitting);
  assert.equal(fitting.customerName, "Alex Golfer");
  assert.equal(fitting.demoDate, "2026-04-15T00:00:00.000Z");
  assert.equal(fitting.estimatedTotal, 299.75);
  assert.equal(fitting.clubs.length, 1);
  assert.deepEqual(fitting.resultsClubs.map((item) => item.id), [11]);
  assert.equal(fitting.resultsClubs[0]?.avgMaxHeight, 30);
  assert.equal(fitting.clubs[0]?.shaft, "Regular");
  assert.equal(fitting.clubs[0]?.launchAngle, 12);
  assert.deepEqual(fitting.clubs[0]?.tags, ["Stiff"]);
  assert.deepEqual(fitting.clubs[0]?.comparisonClub?.tags, ["Used"]);
  assert.equal(fitting.clubs[0]?.comparisonClub?.clubType, "Current Driver");
  const expectedSnapshot = {
    version: 1,
    shots: [{ lateralSignConvention: "unknown", measurements }],
  };
  assert.deepEqual(fitting.clubs[0]?.approvedShotSnapshot, expectedSnapshot);
  assert.deepEqual(fitting.clubs[0]?.comparisonClub?.approvedShotSnapshot, {
    version: 1,
    shots: [{ lateralSignConvention: "unknown", measurements: { ...measurements, carryYd: 190 } }],
  });
  assert.doesNotMatch(
    JSON.stringify(fitting),
    /Unrelated Current|Excluded|clientId|lockerToken|ghl|rawData|sourceBatchId|sourceSummaryId|sourceRowId/i,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(fitting)), fitting);
  assert.equal(await getCustomerSession(8, 31), null);
  assert.equal(await getCustomerSession(7, 33), null);
  assert.ok(queries.some((where) => where.id === 31 && where.clientId === 7 && where.status === "finalized"));

  const originalResultClubs = session.clubTests;
  session.clubTests = [
    { ...current, clubType: "6Iron - Xxio 10", tags: ["Xxio 10"], includeInReport: true },
    { ...demo, clubType: "6Iron", tags: ["Mens14"], availableForPurchase: false },
    { ...demo, id: 15, clubType: "7Iron", tags: ["Mens14"], availableForPurchase: false },
    otherCurrent,
  ];
  const allResults = await getCustomerSession(7, 31);
  assert.ok(allResults);
  assert.deepEqual(allResults.resultsClubs.map((item) => item.id), [10, 11, 15]);
  assert.equal(allResults.purchaseClubs.length, 0);
  const resultsHtml = renderToStaticMarkup(createElement(FittingPresentation, {
    session: allResults, purchaseAction: null,
  })).match(/<section aria-labelledby="club-results-heading"[\s\S]*?<\/section>/)?.[0];
  assert.ok(resultsHtml);
  assert.match(resultsHtml, /6Iron · Xxio 10/);
  assert.match(resultsHtml, /6Iron · Mens14/);
  assert.match(resultsHtml, /7Iron · Mens14/);
  assert.equal(resultsHtml.match(/<tr class="border-t border-border">/g)?.length, 3);
  assert.doesNotMatch(resultsHtml, /Unrelated Current|Xxio 10 · Xxio 10/);
  const allGapping = renderToStaticMarkup(createElement(FittingPresentation, {
    session: allResults, purchaseAction: null,
  })).match(/<section aria-labelledby="club-gapping-heading"[\s\S]*?<\/section>/)?.[0];
  assert.ok(allGapping);
  assert.match(allGapping, /6Iron · Xxio 10/);
  assert.match(allGapping, /6Iron · Mens14/);
  assert.match(allGapping, /7Iron · Mens14/);
  assert.doesNotMatch(allGapping, /Unrelated Current/);
  session.clubTests = [
    { ...current, includeInReport: null },
    { ...demo, includeInReport: null, metrics: { ...demo.metrics, avgMaxHeight: null } },
  ];
  const legacyResults = await getCustomerSession(7, 31);
  assert.deepEqual(legacyResults?.resultsClubs.map((item) => item.id), [11]);
  assert.equal(legacyResults?.resultsClubs[0]?.avgMaxHeight, null);
  session.clubTests = originalResultClubs;

  const originalGroupedClubs = session.clubTests;
  session.clubTests = [
    current,
    demo,
    { ...demo, id: 15, clubType: "Second Driver", tags: ["Regular"], approvedShotSnapshot: snapshot(105, 220) },
  ];
  const grouped = await getCustomerSession(7, 31);
  assert.ok(grouped);
  assert.deepEqual(grouped.clubs.map((item) => item.comparisonClub?.id), [10, 10]);
  assert.deepEqual(linkedDispersionClubs(grouped.clubs, 10).map((item) => item.id), [11, 15]);
  const groupedMarkup = renderToStaticMarkup(createElement(ExplorePerformance, { clubs: grouped.clubs, resultsClubs: grouped.resultsClubs }));
  assert.match(groupedMarkup, /Second Driver · Regular/);
  session.clubTests = originalGroupedClubs;

  const purchaseSource = session.clubTests;
  session.clubTests = [
    { ...demo, tags: ["Stiff"] },
    { ...current, clubType: "Current Driver - Used", tags: ["Used"], availableForPurchase: true, estimatedPrice: decimal("25") },
    otherCurrent,
  ];
  const purchaseFit = await getCustomerSession(7, 31);
  assert.ok(purchaseFit);
  assert.deepEqual(purchaseFit.purchaseClubs, [
    { id: 11, label: "Included Driver - Stiff", estimatedPrice: 299.75 },
    { id: 10, label: "Current Driver - Used — Current Brand", estimatedPrice: 25 },
  ]);
  assert.equal(purchaseFit.estimatedTotal, 324.75);
  session.clubTests = purchaseSource;

  demo.approvedShotSnapshot = { version: 1, shots: [] };
  current.approvedShotSnapshot = null;
  const legacy = await getCustomerSession(7, 31);
  assert.deepEqual(legacy?.clubs[0]?.approvedShotSnapshot, { version: 1, shots: [] });
  assert.equal(legacy?.clubs[0]?.comparisonClub?.approvedShotSnapshot, null);
  const warnings: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => { warnings.push(args); });
  demo.approvedShotSnapshot = { version: 2, shots: [] };
  assert.equal((await getCustomerSession(7, 31))?.clubs[0]?.approvedShotSnapshot, null);
  demo.approvedShotSnapshot = {
    ...snapshot(101),
    shots: [{ ...snapshot(101).shots[0], measurements: { ...measurements, carryYd: "bad" } }],
  };
  assert.equal((await getCustomerSession(7, 31))?.clubs[0]?.approvedShotSnapshot, null);
  assert.equal(warnings.length, 2);
  demo.approvedShotSnapshot = snapshot(101);
  current.approvedShotSnapshot = snapshot(100, 190);

  const originalClubs = session.clubTests;
  session.clubTests = [
    { ...demo, currentClubTestId: null, pairIndex: 0 },
    { ...demo, id: 14, clubType: "Standalone Iron", currentClubTestId: null, pairIndex: 1,
      approvedShotSnapshot: snapshot(104, 160) },
  ];
  const standalone = await getCustomerSession(7, 31);
  assert.ok(standalone);
  assert.equal(standalone.clubs.length, 2);
  for (const [index, expectedCarry] of [210, 160].entries()) {
    const selectedClub: CustomerDemoClub = standalone.clubs[index]!;
    assert.equal(selectedClub.comparisonClub, null);
    const html = renderToStaticMarkup(createElement(ExplorePerformance, { clubs: [selectedClub], resultsClubs: [selectedClub] }));
    assert.match(html, /1 of 1 included shots plotted/);
    assert.match(html, new RegExp(`Carry: ${expectedCarry} yd`));
    assert.doesNotMatch(html, /No measured dispersion available|Compare current/);
  }
  session.clubTests = originalClubs;

  const staffToken = signStaffSessionToken({ staffUserId: 1, expiresAt: Date.now() + 60_000 });
  async function runProxy(request: NextRequest) {
    const response = await proxy(request, new NextFetchEvent({
      request, page: "/staff/demo-sessions/[id]/preview-locker", context: undefined,
    }));
    assert.ok(response instanceof Response);
    return response;
  }
  const unauthenticated = await runProxy(new NextRequest("http://localhost/staff/demo-sessions/31/preview-locker"));
  assert.equal(unauthenticated.status, 307);
  assert.match(unauthenticated.headers.get("location") ?? "", /\/staff\/login/);
  const staffRequest = new NextRequest("http://localhost/staff/demo-sessions/31/preview-locker", {
    headers: { cookie: `staff_session=${staffToken}` },
  });
  assert.equal((await runProxy(staffRequest)).headers.get("x-middleware-next"), "1");

  const previewProps = {
    params: Promise.resolve({ id: "31" }),
    searchParams: Promise.resolve({ from: "/staff/imports/56/map" }),
  };
  const beforePreview = cookieReads;
  const preview = renderToStaticMarkup(await PreviewPage(previewProps));
  assert.equal(cookieReads, beforePreview);
  assert.match(preview, /href="\/staff\/imports\/56\/map"/);
  assert.match(preview, /Back to Fitting Details/);
  assert.match(preview, /Staff Preview/);
  assert.match(preview, /Your Personal Fitting Experience/);
  assert.match(preview, /Your Swing Locker/);
  assert.match(preview, /Prepared for Alex Golfer/);
  assert.match(preview, /April 15, 2026/);
  assert.match(preview, /Explore Your Performance/);
  assert.match(preview, /2 of 2 included shots plotted/);
  assert.match(preview, /Current Driver · Used · Current Brand/);
  assert.match(preview, /Included Driver · Stiff/);
  assert.match(preview, /Included Driver/);
  assert.match(preview, /Current Brand Current Driver/);
  assert.doesNotMatch(preview, /Unrelated Current|Excluded|mailto:|<form/);
  assert.match(preview, /<button[^>]*disabled[^>]*>Request Purchase<\/button>/);

  const customerToken = signSwingLockerSessionToken({ golfClientId: 7, expiresAt: Date.now() + 60_000 });
  cookie = `staff_session=${staffToken}; swing_locker_session=${customerToken}`;
  assert.equal((await runProxy(new NextRequest(staffRequest.url, {
    headers: { cookie },
  }))).headers.get("x-middleware-next"), "1");
  const previewWithCustomerCookie = renderToStaticMarkup(await PreviewPage(previewProps));
  assert.equal(cookieReads, beforePreview);
  assert.match(previewWithCustomerCookie, /<button[^>]*disabled[^>]*>Request Purchase<\/button>/);

  const fallbackPreview = renderToStaticMarkup(await PreviewPage({
    params: Promise.resolve({ id: "31" }),
    searchParams: Promise.resolve({ from: "https://example.test/" }),
  }));
  assert.match(fallbackPreview, /href="\/staff\/imports"/);
  const draftPreview = renderToStaticMarkup(await PreviewPage({
    params: Promise.resolve({ id: "33" }),
    searchParams: Promise.resolve({}),
  }));
  assert.match(draftPreview, /not yet finalized/);

  const customerPage = await CustomerPage({ params: Promise.resolve({ id: "31" }) });
  const fittingElement = customerPage.props.children.props.children[1];
  assert.equal(fittingElement.type, FittingPresentation);
  assert.equal(fittingElement.props.purchaseAction.type, PurchaseRequestTrigger);
  assert.deepEqual(fittingElement.props.purchaseAction.props, {
    sessionId: 31,
    clubs: [{ id: 11, label: "Included Driver - Stiff", estimatedPrice: 299.75 }],
  });
  const customer = renderToStaticMarkup(customerPage);
  assert.match(customer, /href="\/swing-locker\/dashboard"/);
  assert.match(customer, /Back to My Swing Locker/);
  assert.match(customer, /Your Personal Fitting Experience/);
  assert.match(customer, /Your Swing Locker/);
  assert.match(customer, /Prepared for Alex Golfer/);
  assert.match(customer, /April 15, 2026/);
  assert.match(customer, /Explore Your Performance/);
  assert.match(customer, /2 of 2 included shots plotted/);
  assert.match(customer, /Included Driver/);
  assert.match(customer, /Current Brand Current Driver/);
  assert.match(customer, /Total estimated price/);
  assert.match(customer, /<button(?![^>]*disabled)[^>]*>Request Purchase<\/button>/);
  assert.doesNotMatch(customer, /Staff Preview|Unrelated Current|Excluded/);
  demo.availableForPurchase = false;
  const noSaleCustomer = renderToStaticMarkup(await CustomerPage({ params: Promise.resolve({ id: "31" }) }));
  const noSalePreview = renderToStaticMarkup(await PreviewPage(previewProps));
  assert.doesNotMatch(noSaleCustomer, /Equipment Pricing|Request Purchase<\/button>/);
  assert.doesNotMatch(noSalePreview, /Equipment Pricing|Request Purchase<\/button>/);
  demo.availableForPurchase = true;
  await assert.rejects(
    CustomerPage({ params: Promise.resolve({ id: "33" }) }),
    /NEXT_HTTP_ERROR_FALLBACK/,
  );
  await assert.rejects(
    CustomerPage({ params: Promise.resolve({ id: "34" }) }),
    /NEXT_HTTP_ERROR_FALLBACK/,
  );

  const dashboard = renderToStaticMarkup(await Dashboard());
  assert.match(dashboard, /href="\/swing-locker\/dashboard\/sessions\/31"/);
  assert.match(dashboard, /href="\/swing-locker\/dashboard\/sessions\/32"/);
  assert.doesNotMatch(dashboard, /sessions\/33|sessions\/34/);

  hasRequest = true;
  const submittedCustomer = renderToStaticMarkup(await CustomerPage({ params: Promise.resolve({ id: "31" }) }));
  const submittedPreview = renderToStaticMarkup(await PreviewPage(previewProps));
  assert.match(submittedCustomer, /Purchase request submitted/);
  assert.match(submittedPreview, /Purchase request submitted/);
  assert.doesNotMatch(submittedCustomer, /Request Purchase<\/button>/);
  assert.doesNotMatch(submittedPreview, /Request Purchase<\/button>/);
  cookie = "";
  await assert.rejects(
    CustomerPage({ params: Promise.resolve({ id: "31" }) }),
    /NEXT_REDIRECT/,
  );
  assert.equal(networkCalls, 0);
});

test("results, comparisons, and pricing display finalized clubs in order", () => {
  const current = {
    id: 1, clubType: "Current Driver", brand: "Current Brand", model: null,
    tags: [] as string[],
    shaft: null, loft: null, clubSpeed: 88, ballSpeed: 120, smashFactor: null,
    spinRate: 2200, carryDistance: 190, totalDistance: 210, launchAngle: null,
    avgMaxHeight: 30,
    dispersion: null, estimatedPrice: null, approvedShotSnapshot: null,
  };
  const driver: CustomerDemoClub = {
    ...current, id: 2, clubType: "Demo Driver", brand: "Demo Brand", shaft: "Regular",
    clubSpeed: 95.46, ballSpeed: 0, carryDistance: null, totalDistance: 213.6,
    spinRate: null, estimatedPrice: 49.75, comparisonClub: current,
  };
  const iron: CustomerDemoClub = {
    ...driver, id: 3, clubType: "Demo Iron", brand: null, shaft: null,
    clubSpeed: null, ballSpeed: null, carryDistance: null, totalDistance: null,
    avgMaxHeight: null, spinRate: null, estimatedPrice: null, comparisonClub: null,
  };
  const session: CustomerSessionDetail = {
    id: 31, demoDate: "2026-04-15T00:00:00.000Z", customerName: "Alex Golfer",
    notes: null, clubs: [driver, iron], resultsClubs: [current, driver, iron],
    purchaseClubs: [
      { id: driver.id, label: "Demo Driver · Demo Brand", estimatedPrice: 49.75 },
      { id: iron.id, label: "Demo Iron", estimatedPrice: null },
    ],
    estimatedTotal: 49.75,
  };
  const html = renderToStaticMarkup(createElement(FittingPresentation, {
    session, purchaseAction: createElement("button", null, "Purchase action"),
  }));
  const results = html.match(/<section aria-labelledby="club-results-heading"[\s\S]*?<\/section>/)?.[0];
  const comparisons = html.match(/<section aria-labelledby="club-comparisons-heading"[\s\S]*?<\/section>/)?.[0];
  const pricing = html.match(/<section aria-labelledby="equipment-pricing-heading"[\s\S]*?<\/section>/)?.[0];
  assert.ok(results);
  assert.ok(comparisons);
  assert.ok(pricing);
  assert.ok(html.indexOf(results) < html.indexOf(comparisons));
  assert.ok(html.indexOf(results) < html.indexOf("Explore Your Performance"));
  assert.ok(html.indexOf("Explore Your Performance") < html.indexOf(comparisons));
  assert.ok(html.indexOf(comparisons) < html.indexOf(pricing));
  assert.ok(html.indexOf(pricing) < html.indexOf("Purchase action"));
  assert.match(results, /Demo Driver/);
  assert.match(results, /Demo Brand · Regular/);
  assert.match(results, /Demo Iron/);
  assert.match(results, />0\.0<\/td>/);
  assert.match(results, />213\.6<\/td>/);
  assert.match(results, />98\.4<\/td>/);
  assert.match(results, /Club<\/th>[\s\S]*Avg Carry[\s\S]*Avg Total[\s\S]*Ball Speed[\s\S]*Avg Height/);
  assert.doesNotMatch(results, /Club speed|Spin rate|\$50|Estimated price/);
  const rows = results.match(/<tr class="border-t border-border">[\s\S]*?<\/tr>/g);
  assert.equal(rows?.length, 3);
  assert.equal(rows?.[2].match(/>—<\/td>/g)?.length, 4);
  assert.match(comparisons, /Demo Driver[\s\S]*Current Brand Current Driver[\s\S]*88\.0/);
  assert.doesNotMatch(comparisons, /Demo Iron/);
  assert.match(pricing, /Demo Driver · Demo Brand[\s\S]*\$50[\s\S]*Demo Iron[\s\S]*—/);
  assert.match(pricing, /Total estimated price[\s\S]*\$50/);
  assert.match(pricing, /Total includes available estimates only/);
});

test("single and empty fittings handle missing prices and results", () => {
  const club: CustomerDemoClub = {
    id: 1, clubType: "Iron", tags: [], brand: null, model: null, shaft: null, loft: null,
    clubSpeed: null, ballSpeed: null, smashFactor: null, spinRate: null,
    carryDistance: null, totalDistance: null, launchAngle: null, dispersion: null,
    avgMaxHeight: null,
    estimatedPrice: null, approvedShotSnapshot: null, comparisonClub: null,
  };
  const session: CustomerSessionDetail = {
    id: 31, demoDate: "2026-04-15T00:00:00.000Z", customerName: "Alex Golfer",
    notes: null, clubs: [club], resultsClubs: [club], purchaseClubs: [{ id: club.id, label: "Iron", estimatedPrice: null }], estimatedTotal: null,
  };
  const render = (data: CustomerSessionDetail) => renderToStaticMarkup(
    createElement(FittingPresentation, {
      session: data, purchaseAction: data.purchaseClubs.length > 0 ? createElement("button", null, "Purchase action") : null,
    }),
  );
  const single = render(session);
  assert.match(single, /Club Results/);
  assert.match(single, /Equipment Pricing[\s\S]*Iron[\s\S]*—/);
  assert.doesNotMatch(single, /Total estimated price|Current vs\. Demo Club Comparisons/);
  assert.match(single, /Purchase action/);
  const zeroHeight = render({ ...session, resultsClubs: [{ ...club, avgMaxHeight: 0 }] });
  assert.match(zeroHeight, />0\.0<\/td>/);

  const empty = render({ ...session, clubs: [], resultsClubs: [], purchaseClubs: [] });
  assert.match(empty, /No club data recorded for this session/);
  assert.doesNotMatch(empty, /Equipment Pricing|Purchase action|Current vs\. Demo Club Comparisons/);
});

test("customer dispersion plots only usable approved shots and handles missing comparisons", () => {
  const measurements = {
    carryYd: 150, carrySideYd: -3, apexDistanceYd: null, apexHeightYd: null,
    apexSideYd: null, launchAngleDeg: null, launchDirectionDeg: null,
    landingAngleDeg: null, totalYd: null, totalSideYd: null,
  };
  const base = {
    id: 1, clubType: "Iron", tags: ["Stiff"], brand: null, model: null, shaft: null, loft: null,
    clubSpeed: null, ballSpeed: null, smashFactor: null, spinRate: null,
    carryDistance: null, totalDistance: null, launchAngle: null, dispersion: null,
    avgMaxHeight: null,
    estimatedPrice: null,
    approvedShotSnapshot: {
      version: 1 as const,
      shots: [
        { lateralSignConvention: "unknown" as const, measurements },
        { lateralSignConvention: "unknown" as const, measurements: { ...measurements, carrySideYd: 0 } },
        { lateralSignConvention: "unknown" as const, measurements: { ...measurements, carrySideYd: null } },
        { lateralSignConvention: "unknown" as const, measurements: { ...measurements, carryYd: null } },
        { lateralSignConvention: "unknown" as const, measurements: { ...measurements, carryYd: Number.NaN } },
      ],
    },
  };
  const club: CustomerDemoClub = { ...base, comparisonClub: null };
  const render = (clubs: CustomerDemoClub[]) =>
    renderToStaticMarkup(createElement(ExplorePerformance, { clubs, resultsClubs: clubs }));

  const standalone = render([club]);
  assert.match(standalone, /Select club/);
  assert.match(standalone, /Shot Dispersion[\s\S]*Shot Analyzer/);
  assert.match(standalone, /Modeled flight from measured shot data/);
  assert.match(standalone, /No flight visualization available for this selection/);
  assert.equal(standalone.match(/<select/g)?.length, 1);
  assert.match(standalone, /See where your shots landed/);
  assert.match(standalone, /Iron · Stiff/);
  assert.match(standalone, /2 of 5 included shots plotted/);
  assert.match(standalone, /3 without measured carry or lateral omitted/);
  assert.match(standalone, /Lateral: -3 yd/);
  assert.match(standalone, /Lateral: 0 yd/);
  assert.doesNotMatch(standalone, /Demo:|Compare current:|Current:/);

  const noCurrent = render([{ ...club, comparisonClub: { ...base, id: 2, clubType: "Wood", tags: [], approvedShotSnapshot: null } }]);
  assert.match(noCurrent, /No measured dispersion is available for Wood/);
  assert.doesNotMatch(noCurrent, /type="checkbox"/);

  const noDemo = render([{
    ...club,
    approvedShotSnapshot: null,
    comparisonClub: { ...base, id: 2, clubType: "Wood - Used", tags: ["Used"] },
  }]);
  assert.match(noDemo, /No measured dispersion is available for Iron · Stiff/);
  assert.match(noDemo, /Wood · Used/);
  assert.doesNotMatch(noDemo, /Wood · Used · Used/);
  assert.doesNotMatch(noDemo, /type="checkbox"/);
  assert.match(noDemo, /2 of 5 included shots plotted/);

  const combined = render([{ ...club, comparisonClub: { ...base, id: 2, clubType: "Wood", tags: ["Used"] } }]);
  assert.doesNotMatch(combined, /type="checkbox"/);
  assert.match(combined, /4 of 10 included shots plotted/);
  assert.match(combined, /Iron · Stiff · Shot 1/);
  assert.match(combined, /Wood · Used · Shot 1/);

  assert.match(render([{ ...club, approvedShotSnapshot: null }]), /No measured dispersion available/);
  assert.match(render([{ ...club, approvedShotSnapshot: { version: 1, shots: [] } }]), /No measured dispersion available/);
  assert.match(render([]), /No measured dispersion available/);

  const comparison = { ...base, id: 2, clubType: "Wood", tags: [] };
  const first = { ...club, comparisonClub: comparison };
  const second = { ...club, id: 3, clubType: "Driver", tags: ["Regular"], comparisonClub: comparison };
  const unlinked = { ...club, id: 4 };
  assert.deepEqual(linkedDispersionClubs([first, second, unlinked], 2).map((item) => item.id), [1, 3]);
  assert.deepEqual(linkedDispersionClubs([first, second, unlinked], 1).map((item) => item.id), [2]);
  assert.deepEqual(linkedDispersionClubs([first, second, unlinked], 4), []);
});

test("customer flight models use selected and linked approved shots without filling missing measurements", () => {
  const measurements = {
    carryYd: 200, carrySideYd: -7, apexDistanceYd: 100, apexHeightYd: 30,
    apexSideYd: -4, launchAngleDeg: 14, launchDirectionDeg: -2,
    landingAngleDeg: 40, totalYd: 220, totalSideYd: -9,
  };
  const base: CustomerDemoClub = {
    id: 1, clubType: "Iron", tags: [], brand: null, model: null, shaft: null, loft: null,
    clubSpeed: null, ballSpeed: null, smashFactor: null, spinRate: null,
    carryDistance: null, totalDistance: null, avgMaxHeight: null,
    launchAngle: null, dispersion: null, estimatedPrice: null, comparisonClub: null,
    approvedShotSnapshot: {
      version: 1,
      shots: [
        { lateralSignConvention: "unknown", measurements },
        { lateralSignConvention: "unknown", measurements: { ...measurements, carrySideYd: null } },
        { lateralSignConvention: "unknown", measurements: { ...measurements, apexHeightYd: null } },
      ],
    },
  };
  const linked = {
    ...base, id: 2, clubType: "Wood", comparisonClub: undefined,
    approvedShotSnapshot: {
      version: 1 as const,
      shots: [{ lateralSignConvention: "unknown" as const, measurements: {
        ...measurements, launchDirectionDeg: 0, apexSideYd: 0, carrySideYd: 0,
      } }],
    },
  };
  const first = { ...base, comparisonClub: linked };
  const second = { ...base, id: 3, comparisonClub: linked, approvedShotSnapshot: null };
  const unrelated = { ...base, id: 4 };
  const clubs = [first, second, unrelated];

  const firstData = buildCustomerShotFlights([first, ...linkedDispersionClubs(clubs, first.id)]);
  assert.equal(firstData.includedShotCount, 4);
  assert.deepEqual(firstData.flights.map((flight) => flight.shotId), ["1:0", "2:0"]);
  const rendered = toGolfShotVizFlights(firstData.flights);
  assert.ok(rendered.every((flight) => flight.lateralDataAvailable));
  assert.ok(rendered[0]!.points.some((point) => point[2] < 0));
  assert.ok(rendered[1]!.points.every((point) => point[2] === 0));

  const linkedData = buildCustomerShotFlights([linked, ...linkedDispersionClubs(clubs, linked.id)]);
  assert.equal(linkedData.includedShotCount, 4);
  assert.deepEqual(linkedData.flights.map((flight) => flight.shotId), ["2:0", "1:0"]);
  assert.deepEqual(buildCustomerShotFlights([{ id: 5, approvedShotSnapshot: null }]), {
    includedShotCount: 0, flights: [],
  });
  assert.equal(buildCustomerShotFlights([{
    id: 6,
    approvedShotSnapshot: {
      version: 1,
      shots: [{ lateralSignConvention: "unknown", measurements: { ...measurements, launchDirectionDeg: null } }],
    },
  }]).flights.length, 0);
});

test("customer gapping uses approved normalized carries for ranges and averages", () => {
  function snapshot(summaryId: number, unit: "[m]" | "[yrd]", values: (string | null)[]) {
    return buildApprovedShotSnapshot({
      batch: { id: 1, parserMode: "trackman-result" },
      summary: { id: summaryId, importBatchId: 1 },
      rows: values.map((value, rowIndex) => ({
        id: rowIndex + 1,
        importBatchId: 1,
        clubSummaryId: summaryId,
        rowIndex,
        includedInSummary: rowIndex !== 3,
        rawData: {
          measuredShot: createTrackManMeasuredShot({
            headers: ["Measurement.Carry"],
            shotRow: [value],
            siUnitRow: ["[m]"],
            conversionFactorRow: [unit === "[m]" ? "1" : "1.09361"],
            displayUnitRow: [unit],
            exportFormat: "xlsx",
            selectedUnitSystem: unit === "[m]" ? "metric" : "imperial",
          }),
        },
      })),
    });
  }
  const base: CustomerClub = {
    id: 1, clubType: "6Iron", tags: ["Metric"], brand: null, model: null, shaft: null, loft: null,
    clubSpeed: null, ballSpeed: null, smashFactor: null, spinRate: null,
    carryDistance: 999, totalDistance: null, avgMaxHeight: null,
    launchAngle: null, dispersion: null, estimatedPrice: null,
    approvedShotSnapshot: snapshot(1, "[m]", ["100", "110", null, "900"]),
  };
  const imperial: CustomerClub = {
    ...base, id: 2, tags: ["Imperial"],
    approvedShotSnapshot: snapshot(2, "[yrd]", ["110", "120"]),
  };
  const legacy: CustomerClub = { ...base, id: 3, clubType: "Wedge", tags: [], approvedShotSnapshot: null };
  const noCarry: CustomerClub = {
    ...base, id: 4, clubType: "Putter", tags: [],
    approvedShotSnapshot: snapshot(4, "[yrd]", [null]),
  };
  const data = buildCustomerGapping([base, imperial, legacy, noCarry]);
  assert.equal(data.includedShotCount, 6);
  assert.deepEqual(data.unavailableClubs.map((club) => club.id), [3, 4]);
  const metric = data.rows.find((row) => row.summaryId === 1)!;
  assert.equal(metric.points.length, 2);
  assert.ok(Math.abs(metric.minCarryYd - 109.36132983377078) < 1e-8);
  assert.ok(Math.abs(metric.maxCarryYd - 120.29746281714786) < 1e-8);
  assert.ok(Math.abs(metric.averageCarryYd - (metric.minCarryYd + metric.maxCarryYd) / 2) < 1e-8);
  const imperialRow = data.rows.find((row) => row.summaryId === 2)!;
  assert.deepEqual(
    [imperialRow.minCarryYd, imperialRow.maxCarryYd, imperialRow.averageCarryYd],
    [110, 120, 115],
  );
  assert.ok(data.rows.every((row) => row.averageCarryYd !== 999));
  const zero = buildCustomerGapping([{
    ...base, id: 5, approvedShotSnapshot: snapshot(5, "[yrd]", ["0"]),
  }]);
  assert.equal(zero.rows[0]?.averageCarryYd, 0);
  assert.equal(zero.rows[0]?.minCarryYd, 0);

  const first: CustomerDemoClub = { ...base, comparisonClub: null };
  const second: CustomerDemoClub = { ...imperial, comparisonClub: null };
  const render = (clubs: CustomerDemoClub[]) => renderToStaticMarkup(createElement(ExplorePerformance, {
    clubs, resultsClubs: [base, imperial, legacy, noCarry],
  })).match(/<section aria-labelledby="club-gapping-heading"[\s\S]*?<\/section>/)?.[0];
  const gapping = render([first, second]);
  assert.ok(gapping);
  assert.equal(render([second, first]), gapping);
  assert.match(gapping, /6Iron · Metric/);
  assert.match(gapping, /6Iron · Imperial/);
  assert.match(gapping, /average carry of approved shots/);
  assert.match(gapping, /Range: 110\.0–120\.0 yd/);
  assert.match(gapping, /No approved carry measurements: Wedge, Putter/);
  assert.doesNotMatch(gapping, /(?:Carry:|shots:|Range:) (?:999|900)\.0/i);
  const historical = renderToStaticMarkup(createElement(ExplorePerformance, {
    clubs: [], resultsClubs: [legacy],
  }));
  assert.match(historical, /No approved carry measurements are available/);
  assert.match(historical, /No approved carry measurements: Wedge/);
  assert.doesNotMatch(historical, /999\.0/);
});
