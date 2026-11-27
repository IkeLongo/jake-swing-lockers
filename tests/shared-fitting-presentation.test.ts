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
import type { CustomerDemoClub, CustomerSessionDetail } from "../lib/queries/customer-sessions";
import { FittingPresentation } from "../app/swing-locker/_components/FittingPresentation";
import { ExplorePerformance } from "../app/swing-locker/_components/ExplorePerformance";

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
    availableForPurchase: false,
    tags: [] as string[],
    approvedShotSnapshot: null as Prisma.JsonValue,
    metrics: {
      clubSpeed: decimal("90"), ballSpeed: decimal("130"),
      smashFactor: decimal("1.44"), spinRate: 2500,
      carryDistance: decimal("210"), totalDistance: decimal("230"),
      launchAngle: decimal("12"), dispersion: decimal("8"),
    },
  });
  const current = {
    ...club(10, "current", "Current Driver", 0),
    brand: "Current Brand",
    approvedShotSnapshot: snapshot(100, 190) as Prisma.JsonValue,
  };
  const demo = {
    ...club(11, "demo", "Included Driver", 0),
    currentClubTestId: current.id,
    shaft: "Regular",
    estimatedPrice: decimal("299.75"),
    availableForPurchase: true,
    approvedShotSnapshot: snapshot(101) as Prisma.JsonValue,
  };
  const otherCurrent = {
    ...club(12, "current", "Unrelated Current", 1),
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
          select: { clientId?: boolean; clubTests?: { select: { approvedShotSnapshot?: boolean } } };
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
  assert.equal(fitting.clubs[0]?.shaft, "Regular");
  assert.equal(fitting.clubs[0]?.launchAngle, 12);
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
    const html = renderToStaticMarkup(createElement(ExplorePerformance, { clubs: [selectedClub] }));
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
  assert.match(preview, /Compare current: Current Driver/);
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
    clubs: [{ id: 11, label: "Included Driver", estimatedPrice: 299.75 }],
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
    shaft: null, loft: null, clubSpeed: 88, ballSpeed: 120, smashFactor: null,
    spinRate: 2200, carryDistance: 190, totalDistance: 210, launchAngle: null,
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
    spinRate: null, estimatedPrice: null, comparisonClub: null,
  };
  const session: CustomerSessionDetail = {
    id: 31, demoDate: "2026-04-15T00:00:00.000Z", customerName: "Alex Golfer",
    notes: null, clubs: [driver, iron],
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
  assert.match(results, /95\.5/);
  assert.match(results, />0\.0<\/td>/);
  assert.match(results, />214<\/td>/);
  assert.match(results, /Club speed[\s\S]*Ball speed[\s\S]*Carry[\s\S]*Total[\s\S]*Spin rate/);
  assert.doesNotMatch(results, /Current Driver|\$50|Estimated price/);
  const rows = results.match(/<tr class="border-t border-border">[\s\S]*?<\/tr>/g);
  assert.equal(rows?.length, 2);
  assert.equal(rows?.[1].match(/>—<\/td>/g)?.length, 5);
  assert.match(comparisons, /Demo Driver[\s\S]*Current Brand Current Driver[\s\S]*88\.0/);
  assert.doesNotMatch(comparisons, /Demo Iron/);
  assert.match(pricing, /Demo Driver · Demo Brand[\s\S]*\$50[\s\S]*Demo Iron[\s\S]*—/);
  assert.match(pricing, /Total estimated price[\s\S]*\$50/);
  assert.match(pricing, /Total includes available estimates only/);
});

test("single and empty fittings handle missing prices and results", () => {
  const club: CustomerDemoClub = {
    id: 1, clubType: "Iron", brand: null, model: null, shaft: null, loft: null,
    clubSpeed: null, ballSpeed: null, smashFactor: null, spinRate: null,
    carryDistance: null, totalDistance: null, launchAngle: null, dispersion: null,
    estimatedPrice: null, approvedShotSnapshot: null, comparisonClub: null,
  };
  const session: CustomerSessionDetail = {
    id: 31, demoDate: "2026-04-15T00:00:00.000Z", customerName: "Alex Golfer",
    notes: null, clubs: [club], purchaseClubs: [{ id: club.id, label: "Iron", estimatedPrice: null }], estimatedTotal: null,
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

  const empty = render({ ...session, clubs: [], purchaseClubs: [] });
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
    id: 1, clubType: "Demo Iron", brand: null, model: null, shaft: null, loft: null,
    clubSpeed: null, ballSpeed: null, smashFactor: null, spinRate: null,
    carryDistance: null, totalDistance: null, launchAngle: null, dispersion: null,
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
    renderToStaticMarkup(createElement(ExplorePerformance, { clubs }));

  const standalone = render([club]);
  assert.match(standalone, /Demo club/);
  assert.match(standalone, /2 of 5 included shots plotted/);
  assert.match(standalone, /3 without measured carry or lateral omitted/);
  assert.match(standalone, /Lateral: -3 yd/);
  assert.match(standalone, /Lateral: 0 yd/);
  assert.doesNotMatch(standalone, /Compare current/);

  const noCurrent = render([{ ...club, comparisonClub: { ...base, id: 2, approvedShotSnapshot: null } }]);
  assert.match(noCurrent, /No measured dispersion is available for the current club/);
  assert.doesNotMatch(noCurrent, /type="checkbox"/);

  const noDemo = render([{
    ...club,
    approvedShotSnapshot: null,
    comparisonClub: { ...base, id: 2, clubType: "Current Iron" },
  }]);
  assert.match(noDemo, /No measured dispersion is available for this demo club/);
  assert.match(noDemo, /Compare current: Current Iron/);
  assert.match(noDemo, /2 of 5 included shots plotted/);

  assert.match(render([{ ...club, approvedShotSnapshot: null }]), /No measured dispersion available/);
  assert.match(render([{ ...club, approvedShotSnapshot: { version: 1, shots: [] } }]), /No measured dispersion available/);
  assert.match(render([]), /No measured dispersion available/);
});
