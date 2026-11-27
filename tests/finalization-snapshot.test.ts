import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { Prisma, type ImportClubSummary } from "@/app/generated/prisma/client";
import { signStaffSessionToken } from "@/lib/auth/session";
import { createTrackManMeasuredShot } from "@/lib/imports/trackmanMeasurements";
import {
  deleteSessionClubs,
  flattenPlan,
  persistPlan,
  planComparisonGroups,
} from "@/lib/imports/finalizationPlan";
import { createPrismaFinalizeStore } from "@/lib/imports/finalizationStore";

const routeDb = {};

function summary(id: number, overrides: Partial<ImportClubSummary> = {}): ImportClubSummary {
  return {
    id,
    importBatchId: 1,
    originalClubName: `Club ${id}`,
    clubName: `Club ${id}`,
    shotCount: 1,
    avgClubSpeed: null,
    avgBallSpeed: null,
    avgSpinRate: null,
    avgMaxHeight: null,
    avgCarry: new Prisma.Decimal(175),
    avgTotal: null,
    validClubSpeedCount: 0,
    validBallSpeedCount: 0,
    validSpinRateCount: 0,
    validMaxHeightCount: 0,
    validCarryCount: 1,
    validTotalCount: 0,
    isManuallyEdited: true,
    includeInReport: true,
    availableForPurchase: false,
    tags: [],
    estimatedPrice: null,
    linkedToSummaryId: null,
    currentSummaryId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function shot(id: number, clubSummaryId: number | null, includedInSummary: boolean | null = true) {
  return {
    id,
    importBatchId: 1,
    clubSummaryId,
    includedInSummary,
    rowIndex: id,
    rawData: {
      measuredShot: createTrackManMeasuredShot({
        headers: ["Measurement.Carry", "Measurement.CarrySide"],
        shotRow: [String(id * 10), "-6"],
        siUnitRow: ["[m]", "[m]"],
        conversionFactorRow: ["1.09361", "3.28084"],
        displayUnitRow: ["[yrd]", "[ft]"],
        exportFormat: "xlsx",
        selectedUnitSystem: "US",
      }),
    },
  };
}

function harness(parserMode = "trackman-result") {
  const rows = [shot(1, 10), shot(2, 20), shot(3, 20, false), shot(4, 30)];
  const clubs: Array<{ id: number; data: Prisma.DemoClubTestUncheckedCreateInput }> = [];
  const metrics: Prisma.ClubTestMetricsUncheckedCreateInput[] = [];
  let nextId = 100;
  let rowReads = 0;
  const tx = {
    importBatch: {
      async findUniqueOrThrow({ where }: { where: { id: number } }) {
        return { id: where.id, parserMode };
      },
    },
    importRow: {
      async findMany({ where }: { where: { importBatchId: number } }) {
        rowReads++;
        return rows.filter((row) => row.importBatchId === where.importBatchId);
      },
    },
    demoClubTest: {
      async findMany() {
        return clubs.map(({ id, data }) => ({
          id,
          currentClubTestId: data.currentClubTestId ?? null,
        }));
      },
      async create({ data }: { data: Prisma.DemoClubTestUncheckedCreateInput }) {
        const id = nextId++;
        clubs.push({ id, data });
        return { id };
      },
      async deleteMany({ where }: { where: { id: { in: number[] } } }) {
        for (let i = clubs.length - 1; i >= 0; i--) {
          if (where.id.in.includes(clubs[i]!.id)) clubs.splice(i, 1);
        }
      },
    },
    clubTestMetrics: {
      async create({ data }: { data: Prisma.ClubTestMetricsUncheckedCreateInput }) {
        metrics.push(data);
      },
      async deleteMany({ where }: { where: { clubTestId: { in: number[] } } }) {
        for (let i = metrics.length - 1; i >= 0; i--) {
          if (where.clubTestId.in.includes(metrics[i]!.clubTestId)) metrics.splice(i, 1);
        }
      },
    },
  };

  return {
    rows,
    clubs,
    metrics,
    tx,
    rowReads: () => rowReads,
    store: () => createPrismaFinalizeStore(tx as unknown as Prisma.TransactionClient),
  };
}

function plan() {
  return flattenPlan(planComparisonGroups([
    summary(10, { includeInReport: false }),
    summary(20, { currentSummaryId: 10 }),
    summary(30, { includeInReport: false }),
  ]));
}

test("finalization persists snapshots for included tests and linked current clubs", async () => {
  const h = harness();
  await persistPlan(h.store(), 7, plan());

  assert.equal(h.rowReads(), 1);
  assert.equal(h.clubs.length, 2);
  assert.equal(h.clubs[1]!.data.currentClubTestId, h.clubs[0]!.id);
  assert.deepEqual(
    h.clubs.map(({ data }) => {
      const snapshot = data.approvedShotSnapshot;
      assert.ok(snapshot && typeof snapshot === "object" && "shots" in snapshot);
      return {
        sourceSummaryId: snapshot.sourceSummaryId,
        rowIds: Array.isArray(snapshot.shots)
          ? snapshot.shots.map((shot) => shot.sourceRowId)
          : null,
      };
    }),
    [{ sourceSummaryId: 10, rowIds: [1] }, { sourceSummaryId: 20, rowIds: [2] }],
  );
  assert.ok(h.metrics.every((metric) => String(metric.carryDistance) === "175"));
});

test("finalization and re-finalization persist sale eligibility and tags", async () => {
  const h = harness();
  const makePlan = (sale: boolean) => flattenPlan(planComparisonGroups([
    summary(10, { includeInReport: false, availableForPurchase: true, tags: ["Used"] }),
    summary(20, { currentSummaryId: 10, availableForPurchase: sale, tags: ["Stiff"] }),
  ]));
  await persistPlan(h.store(), 7, makePlan(true));
  assert.deepEqual(h.clubs.map(({ data }) => [data.availableForPurchase, data.tags]), [
    [false, ["Used"]], [true, ["Stiff"]],
  ]);
  const store = h.store();
  await deleteSessionClubs(store, 7);
  await persistPlan(store, 7, makePlan(false));
  assert.deepEqual(h.clubs.map(({ data }) => [data.availableForPurchase, data.tags]), [
    [false, ["Used"]], [false, ["Stiff"]],
  ]);
});

test("finalization and re-finalization persist inclusion and approved height", async () => {
  const h = harness();
  const makePlan = (included: boolean, height: string) => flattenPlan(planComparisonGroups([
    summary(10, { includeInReport: included, avgMaxHeight: new Prisma.Decimal(height) }),
    summary(20, { currentSummaryId: 10, avgMaxHeight: new Prisma.Decimal("25.75") }),
  ]));
  const store = h.store();
  await persistPlan(store, 7, makePlan(false, "30.25"));
  assert.deepEqual(h.clubs.map(({ data }) => data.includeInReport), [false, true]);
  assert.deepEqual(h.metrics.map((metric) => String(metric.avgMaxHeight)), ["30.25", "25.75"]);

  await deleteSessionClubs(store, 7);
  await persistPlan(store, 7, makePlan(true, "35.5"));
  assert.deepEqual(h.clubs.map(({ data }) => data.includeInReport), [true, true]);
  assert.deepEqual(h.metrics.map((metric) => String(metric.avgMaxHeight)), ["35.5", "25.75"]);
});

test("finalization persists usable snapshots independently for standalone demo clubs", async () => {
  const h = harness();
  const rows = flattenPlan(planComparisonGroups([summary(20), summary(30)]));
  await persistPlan(h.store(), 7, rows);

  assert.equal(h.clubs.length, 2);
  for (const [index, expected] of [
    { summaryId: 20, rowId: 2, carryYd: 20 },
    { summaryId: 30, rowId: 4, carryYd: 40 },
  ].entries()) {
    const data = h.clubs[index]!.data;
    assert.equal(data.clubRole, "demo");
    assert.equal(data.currentClubTestId, null);
    const snapshot = data.approvedShotSnapshot;
    assert.ok(snapshot && typeof snapshot === "object" && "shots" in snapshot);
    assert.equal(snapshot.sourceSummaryId, expected.summaryId);
    assert.ok(Array.isArray(snapshot.shots));
    assert.equal(snapshot.shots.length, 1);
    assert.equal(snapshot.shots[0].sourceRowId, expected.rowId);
    assert.equal(snapshot.shots[0].measurements.carryYd, expected.carryYd);
    assert.equal(snapshot.shots[0].measurements.carrySideYd, -2);
  }
});

test("re-finalization replaces snapshots with the newly approved shot selection", async () => {
  const h = harness();
  await persistPlan(h.store(), 7, plan());
  const oldIds = h.clubs.map(({ id }) => id);
  h.rows[1]!.includedInSummary = false;
  h.rows[2]!.includedInSummary = true;

  const store = h.store();
  await deleteSessionClubs(store, 7);
  await persistPlan(store, 7, plan());

  assert.equal(h.clubs.length, 2);
  assert.ok(h.clubs.every(({ id }) => !oldIds.includes(id)));
  const snapshot = h.clubs[1]!.data.approvedShotSnapshot;
  assert.ok(snapshot && typeof snapshot === "object" && "shots" in snapshot);
  assert.ok(Array.isArray(snapshot.shots));
  assert.deepEqual(snapshot.shots.map((shot) => shot.sourceRowId), [3]);
});

test("generic batches and unassociated legacy rows do not acquire snapshots", async () => {
  const generic = harness("generic");
  await persistPlan(generic.store(), 7, plan());
  assert.equal(generic.rowReads(), 0);
  assert.ok(generic.clubs.every(({ data }) => data.approvedShotSnapshot === undefined));

  const legacy = harness();
  legacy.rows.push(shot(5, null));
  await persistPlan(legacy.store(), 7, plan());
  assert.ok(legacy.clubs.every(({ data }) => data.approvedShotSnapshot === undefined));
});

test("re-finalization blocks purchase requests before replacing clubs", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  const previousPrisma = Object.getOwnPropertyDescriptor(globalThis, "prisma");
  process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-characters";
  let purchaseChecks = 0;
  let purchaseCount = 1;
  Object.defineProperty(globalThis, "prisma", {
    configurable: true,
    writable: true,
    value: Object.assign(routeDb, {
      demoSession: {
        async findUnique() {
          return { id: 7, status: "finalized", needsRefinalization: true };
        },
      },
      importBatch: {
        async findUnique() {
          return { id: 1, demoSessionId: 7, status: "finalized" };
        },
      },
      async $transaction(fn: (tx: object) => Promise<unknown>) {
        return fn({
          async $queryRaw() { return [{ id: 7 }]; },
          demoSession: {
            async findUnique() { return { status: "finalized", needsRefinalization: true }; },
          },
          importClubSummary: { async findMany() { return [summary(20)]; } },
          purchaseRequest: {
            async count() {
              purchaseChecks++;
              return purchaseCount;
            },
          },
          importBatch: { async count() { return 1; } },
        });
      },
    }),
  });

  try {
    const { POST } = await import("@/app/api/staff/demo-sessions/[id]/finalize/route");
    const token = signStaffSessionToken({ staffUserId: 1, expiresAt: Date.now() + 60_000 });
    const request = new NextRequest("http://localhost/api/staff/demo-sessions/7/finalize", {
      method: "POST",
      headers: { cookie: `staff_session=${token}`, "content-type": "application/json" },
      body: JSON.stringify({ batchId: 1 }),
    });
    const response = await POST(request, { params: Promise.resolve({ id: "7" }) });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /purchase requests/);
    assert.equal(purchaseChecks, 1);
    purchaseCount = 0;
    const multiBatchResponse = await POST(new NextRequest("http://localhost/finalize", {
      method: "POST",
      headers: { cookie: `staff_session=${token}`, "content-type": "application/json" },
      body: JSON.stringify({ batchId: 1 }),
    }), { params: Promise.resolve({ id: "7" }) });
    assert.equal(multiBatchResponse.status, 409);
    assert.match((await multiBatchResponse.json()).error, /multiple import batches/);
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
    if (previousPrisma) Object.defineProperty(globalThis, "prisma", previousPrisma);
    else Reflect.deleteProperty(globalThis, "prisma");
  }
});

test("re-finalization publishes revised club data while preserving session associations", async (t) => {
  const previousSecret = process.env.SESSION_SECRET;
  const previousPrisma = Object.getOwnPropertyDescriptor(globalThis, "prisma");
  process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-characters";
  t.after(() => {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
    if (previousPrisma) Object.defineProperty(globalThis, "prisma", previousPrisma);
    else Reflect.deleteProperty(globalThis, "prisma");
  });
  const h = harness();
  await persistPlan(h.store(), 7, flattenPlan(planComparisonGroups([summary(20)])));
  const oldClubId = h.clubs[0]!.id;
  h.rows[1]!.includedInSummary = false;
  h.rows[2]!.includedInSummary = true;
  const session = {
    id: 7, status: "finalized", needsRefinalization: true,
    clientId: 55, ghlOpportunityId: "opportunity-1", lockerToken: "locker-1",
  };
  const revised = summary(20, {
    clubName: "Revised driver",
    tags: ["Stiff"],
    availableForPurchase: true,
    estimatedPrice: new Prisma.Decimal(425),
    avgCarry: new Prisma.Decimal(190),
    avgMaxHeight: new Prisma.Decimal("31.25"),
  });
  const tx = {
    ...h.tx,
    async $queryRaw() { return [{ id: 7 }]; },
    demoSession: {
      async findUnique({ select }: { select: { clientId?: boolean } }) {
        if (select.clientId) return null;
        return { ...session };
      },
      async update({ data }: { data: { status: string; needsRefinalization: boolean } }) {
        Object.assign(session, data);
        return session;
      },
    },
    importClubSummary: { async findMany() { return [revised]; } },
    importBatch: {
      ...h.tx.importBatch,
      async count() { return 0; },
      async update() { return { id: 1 }; },
    },
    purchaseRequest: { async count() { return 0; } },
  };
  Object.defineProperty(globalThis, "prisma", {
    configurable: true,
    value: Object.assign(routeDb, {
      demoSession: { async findUnique() { return { ...session }; } },
      importBatch: { async findUnique() { return { id: 1, demoSessionId: 7, status: "finalized" }; } },
      async $transaction(fn: (client: typeof tx) => Promise<unknown>) { return fn(tx); },
    }),
  });
  const { POST } = await import("@/app/api/staff/demo-sessions/[id]/finalize/route");
  const token = signStaffSessionToken({ staffUserId: 1, expiresAt: Date.now() + 60_000 });
  const response = await POST(new NextRequest("http://localhost/finalize", {
    method: "POST",
    headers: { cookie: `staff_session=${token}`, "content-type": "application/json" },
    body: JSON.stringify({ batchId: 1 }),
  }), { params: Promise.resolve({ id: "7" }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).isRefinalize, true);
  assert.deepEqual(session, {
    id: 7, status: "finalized", needsRefinalization: false,
    clientId: 55, ghlOpportunityId: "opportunity-1", lockerToken: "locker-1",
  });
  assert.equal(h.clubs.length, 1);
  assert.notEqual(h.clubs[0]!.id, oldClubId);
  const club = h.clubs[0]!.data;
  assert.equal(club.clubType, "Revised driver");
  assert.deepEqual(club.tags, ["Stiff"]);
  assert.equal(club.availableForPurchase, true);
  assert.equal(String(club.estimatedPrice), "425");
  assert.equal(String(h.metrics[0]!.carryDistance), "190");
  assert.equal(club.includeInReport, true);
  assert.equal(String(h.metrics[0]!.avgMaxHeight), "31.25");
  const snapshot = club.approvedShotSnapshot;
  assert.ok(snapshot && typeof snapshot === "object" && "shots" in snapshot);
  assert.ok(Array.isArray(snapshot.shots));
  assert.deepEqual(snapshot.shots.map((item) => item.sourceRowId), [3]);
});
