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
        headers: ["Measurement.Carry"],
        shotRow: [String(id * 10)],
        siUnitRow: ["[m]"],
        conversionFactorRow: ["1.09361"],
        displayUnitRow: ["[yrd]"],
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
  Object.defineProperty(globalThis, "prisma", {
    configurable: true,
    writable: true,
    value: {
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
          importClubSummary: { async findMany() { return [summary(20)]; } },
          purchaseRequest: {
            async count() {
              purchaseChecks++;
              return 1;
            },
          },
        });
      },
    },
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
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
    if (previousPrisma) Object.defineProperty(globalThis, "prisma", previousPrisma);
    else Reflect.deleteProperty(globalThis, "prisma");
  }
});
