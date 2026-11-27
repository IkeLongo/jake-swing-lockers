import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { signStaffSessionToken } from "@/lib/auth/session";
import {
  aggregateTrackManClubGroups,
  type ClubSummaryInput,
} from "@/lib/imports/trackmanAggregation";
import {
  calculateIncludedTrackManSummaryMetrics,
  type TrackManAssociatedShot,
} from "@/lib/imports/trackmanClubSummaryPersistence";
import {
  isStagedTrackManBatch,
  isTrackManBatch,
  isTrackManShotAssociatedWithSummary,
  parsePositiveRouteId,
} from "@/lib/imports/trackmanShotReview";

function shot(
  clubType: string,
  tags: string[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    "Club.Type": clubType,
    tags,
    "Measurement.ClubSpeed": "80",
    "Measurement.BallSpeed": "110",
    "Measurement.SpinRate": "2500",
    "MaxHeight.Height": "25",
    "Measurement.Carry": "150",
    "Measurement.Total": "160",
    ...overrides,
  };
}

function includedShot(
  rawData: Record<string, unknown>,
  includedInSummary: boolean | null = true,
): TrackManAssociatedShot {
  return { rawData, includedInSummary };
}

test("groups normalized club and tags together and keeps distinct groups separate", () => {
  const groups = aggregateTrackManClubGroups([
    shot("  6 Iron ", [" B ", "A"]),
    shot("6 Iron", ["A", "B"]),
    shot("6 Iron", ["A"]),
    shot("7 Iron", ["A", "B"]),
  ]);

  const sixIronAb = groups.find(
    ({ summary }) => summary.clubName === "6 Iron" && summary.tags.join(",") === "A,B",
  );
  assert.ok(sixIronAb);
  assert.deepEqual(sixIronAb.rowIndexes, [0, 1]);
  assert.equal(sixIronAb.summary.shotCount, 2);
  assert.equal(groups.length, 3);
});

test("only included shots contribute and toggling exclusion recalculates averages", () => {
  const shots = [
    includedShot(shot("Driver", [], { "Measurement.Carry": "200" })),
    includedShot(shot("Driver", [], { "Measurement.Carry": "100" })),
  ];

  const initial = calculateIncludedTrackManSummaryMetrics(shots);
  assert.equal(initial.shotCount, 2);
  assert.equal(initial.avgCarry, 150);

  shots[1]!.includedInSummary = false;
  const recalculated = calculateIncludedTrackManSummaryMetrics(shots);
  assert.equal(recalculated.shotCount, 1);
  assert.equal(recalculated.avgCarry, 200);
});

test("missing and invalid measurements are ignored rather than treated as zero", () => {
  const metrics = calculateIncludedTrackManSummaryMetrics([
    includedShot(
      shot("Driver", [], {
        "Measurement.ClubSpeed": "",
        "Measurement.BallSpeed": "not a number",
        "Measurement.SpinRate": "—",
        "MaxHeight.Height": null,
        "Measurement.Carry": "200",
        "Measurement.Total": "NaN",
      }),
    ),
    includedShot(
      shot("Driver", [], {
        "Measurement.ClubSpeed": "100",
        "Measurement.BallSpeed": "120",
        "Measurement.SpinRate": "2400",
        "MaxHeight.Height": "30",
        "Measurement.Carry": "—",
        "Measurement.Total": "170",
      }),
    ),
  ]);

  assert.equal(metrics.shotCount, 2);
  assert.equal(metrics.avgClubSpeed, 100);
  assert.equal(metrics.validClubSpeedCount, 1);
  assert.equal(metrics.avgBallSpeed, 120);
  assert.equal(metrics.validBallSpeedCount, 1);
  assert.equal(metrics.avgSpinRate, 2400);
  assert.equal(metrics.validSpinRateCount, 1);
  assert.equal(metrics.avgMaxHeight, 30);
  assert.equal(metrics.validMaxHeightCount, 1);
  assert.equal(metrics.avgCarry, 200);
  assert.equal(metrics.validCarryCount, 1);
  assert.equal(metrics.avgTotal, 170);
  assert.equal(metrics.validTotalCount, 1);
});

test("all excluded shots retain a zero count and null averages", () => {
  const metrics = calculateIncludedTrackManSummaryMetrics([
    includedShot(shot("Driver", []), false),
    includedShot(shot("Driver", []), false),
  ]);

  assert.deepEqual(metrics, {
    shotCount: 0,
    avgClubSpeed: null,
    avgBallSpeed: null,
    avgSpinRate: null,
    avgMaxHeight: null,
    avgCarry: null,
    avgTotal: null,
    validClubSpeedCount: 0,
    validBallSpeedCount: 0,
    validSpinRateCount: 0,
    validMaxHeightCount: 0,
    validCarryCount: 0,
    validTotalCount: 0,
  });
});

test("recalculation payload contains only derived fields and preserves review state", () => {
  const staffState = {
    id: 12,
    clubName: "Edited name",
    tags: ["reviewed"],
    includeInReport: false,
    linkedToSummaryId: 9,
    estimatedPrice: 499,
    isManuallyEdited: true,
  };
  const metrics = calculateIncludedTrackManSummaryMetrics([
    includedShot(shot("Driver", [])),
  ]);
  const updated = { ...staffState, ...metrics };

  assert.equal(updated.clubName, staffState.clubName);
  assert.deepEqual(updated.tags, staffState.tags);
  assert.equal(updated.includeInReport, staffState.includeInReport);
  assert.equal(updated.linkedToSummaryId, staffState.linkedToSummaryId);
  assert.equal(updated.estimatedPrice, staffState.estimatedPrice);
  assert.equal(updated.isManuallyEdited, staffState.isManuallyEdited);
  assert.deepEqual(Object.keys(metrics).sort(), [
    "avgBallSpeed",
    "avgCarry",
    "avgClubSpeed",
    "avgMaxHeight",
    "avgSpinRate",
    "avgTotal",
    "shotCount",
    "validBallSpeedCount",
    "validCarryCount",
    "validClubSpeedCount",
    "validMaxHeightCount",
    "validSpinRateCount",
    "validTotalCount",
  ]);
});

test("staged TrackMan and shot-summary ownership checks reject invalid associations", () => {
  assert.equal(
    isStagedTrackManBatch({ parserMode: "trackman-result", demoSessionId: null }),
    true,
  );
  assert.equal(
    isStagedTrackManBatch({ parserMode: "generic", demoSessionId: null }),
    false,
  );
  assert.equal(
    isStagedTrackManBatch({ parserMode: "trackman-result", demoSessionId: 4 }),
    false,
  );

  assert.equal(
    isTrackManShotAssociatedWithSummary(3, 8, {
      importBatchId: 3,
      clubSummaryId: 8,
    }),
    true,
  );
  assert.equal(
    isTrackManShotAssociatedWithSummary(3, 8, {
      importBatchId: 4,
      clubSummaryId: 8,
    }),
    false,
  );
  assert.equal(
    isTrackManShotAssociatedWithSummary(3, 8, {
      importBatchId: 3,
      clubSummaryId: 9,
    }),
    false,
  );
});

test("isTrackManBatch allows both staged and finalized TrackMan imports for read-only access", () => {
  // Staged TrackMan import (unconfirmed)
  assert.equal(
    isTrackManBatch({ parserMode: "trackman-result", demoSessionId: null }),
    true,
  );
  // Finalized TrackMan import (confirmed with DemoSession)
  assert.equal(
    isTrackManBatch({ parserMode: "trackman-result", demoSessionId: 4 }),
    true,
  );
  // Generic (non-TrackMan) import - should still be rejected
  assert.equal(
    isTrackManBatch({ parserMode: "generic", demoSessionId: null }),
    false,
  );
  assert.equal(
    isTrackManBatch({ parserMode: "generic", demoSessionId: 5 }),
    false,
  );
});

test("route ID parser accepts positive safe integers only", () => {
  assert.equal(parsePositiveRouteId("12"), 12);
  assert.equal(parsePositiveRouteId("0"), null);
  assert.equal(parsePositiveRouteId("-2"), null);
  assert.equal(parsePositiveRouteId("1.2"), null);
  assert.equal(parsePositiveRouteId("9007199254740992"), null);
});

test("legacy and generic rows remain unassociated unless explicitly mapped", () => {
  const untouchedLegacyRow = {
    importBatchId: 1,
    clubSummaryId: null,
    includedInSummary: null,
  };
  assert.equal(
    isTrackManShotAssociatedWithSummary(1, 5, untouchedLegacyRow),
    false,
  );
});

test("aggregation summary shape remains unchanged for existing callers", () => {
  const group = aggregateTrackManClubGroups([shot("Driver", [])])[0];
  assert.ok(group);
  const summary: ClubSummaryInput = group.summary;
  assert.equal(summary.clubName, "Driver");
  assert.deepEqual(Object.keys(summary).sort(), [
    "avgBallSpeed",
    "avgCarry",
    "avgClubSpeed",
    "avgMaxHeight",
    "avgSpinRate",
    "avgTotal",
    "clubName",
    "originalClubName",
    "shotCount",
    "tags",
    "validBallSpeedCount",
    "validCarryCount",
    "validClubSpeedCount",
    "validMaxHeightCount",
    "validSpinRateCount",
    "validTotalCount",
  ]);
});

test("finalized TrackMan shot edits mark the session dirty and recalculate included shots", async (t) => {
  const previousPrisma = Object.getOwnPropertyDescriptor(globalThis, "prisma");
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-characters";
  t.after(() => {
    if (previousPrisma) Object.defineProperty(globalThis, "prisma", previousPrisma);
    else Reflect.deleteProperty(globalThis, "prisma");
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  });

  const batch = {
    parserMode: "trackman-result",
    demoSessionId: 7 as number | null,
    status: "finalized",
    demoSession: { status: "finalized" },
  };
  const rows = [
    { id: 1, importBatchId: 1, clubSummaryId: 2, rawData: shot("Driver", [], { "Measurement.Carry": "200" }), includedInSummary: true },
    { id: 2, importBatchId: 1, clubSummaryId: 2, rawData: shot("Driver", [], { "Measurement.Carry": "100" }), includedInSummary: true },
  ];
  let dirty = false;
  const tx = {
    importBatch: { async findUnique() { return batch; } },
    demoSession: {
      async updateMany({ where, data }: { where: { id: number; status: string }; data: { needsRefinalization: boolean } }) {
        assert.deepEqual(where, { id: 7, status: "finalized" });
        dirty = data.needsRefinalization;
        return { count: 1 };
      },
    },
    importClubSummary: {
      async findFirst() { return { id: 2 }; },
      async update({ data }: { data: ReturnType<typeof calculateIncludedTrackManSummaryMetrics> }) {
        const decimal = (n: number | null) => n === null ? null : new Prisma.Decimal(n);
        return {
          id: 2, ...data,
          avgClubSpeed: decimal(data.avgClubSpeed),
          avgBallSpeed: decimal(data.avgBallSpeed),
          avgSpinRate: decimal(data.avgSpinRate),
          avgMaxHeight: decimal(data.avgMaxHeight),
          avgCarry: decimal(data.avgCarry),
          avgTotal: decimal(data.avgTotal),
        };
      },
    },
    importRow: {
      async findUnique({ where }: { where: { id: number } }) { return rows.find((row) => row.id === where.id) ?? null; },
      async updateMany({ where, data }: { where: { id: number }; data: { includedInSummary: boolean } }) {
        const row = rows.find((item) => item.id === where.id);
        if (!row) return { count: 0 };
        row.includedInSummary = data.includedInSummary;
        return { count: 1 };
      },
      async findMany() { return rows; },
    },
  };
  Object.defineProperty(globalThis, "prisma", {
    configurable: true,
    writable: true,
    value: { async $transaction(fn: (client: typeof tx) => Promise<unknown>) { return fn(tx); } },
  });
  const { PATCH } = await import("@/app/api/staff/imports/[id]/club-summaries/[summaryId]/shots/[rowId]/route");
  const token = signStaffSessionToken({ staffUserId: 1, expiresAt: Date.now() + 60_000 });
  const patch = (rowId: number, included: boolean) => PATCH(new NextRequest("http://localhost/shot", {
    method: "PATCH",
    headers: { cookie: `staff_session=${token}`, "content-type": "application/json" },
    body: JSON.stringify({ included }),
  }), { params: Promise.resolve({ id: "1", summaryId: "2", rowId: String(rowId) }) });

  const response = await patch(2, false);
  assert.equal(response.status, 200);
  assert.equal(dirty, true);
  assert.equal(rows[1]!.includedInSummary, false);
  assert.equal((await response.json()).summary.avgCarry, 200);

  dirty = false;
  assert.equal((await patch(99, false)).status, 404);
  assert.equal(dirty, false);
  batch.demoSession.status = "draft";
  assert.equal((await patch(1, false)).status, 409);
  assert.equal(rows[0]!.includedInSummary, true);
  assert.equal(dirty, false);

  batch.demoSessionId = null;
  batch.status = "reviewing";
  assert.equal((await patch(2, true)).status, 200);
  assert.equal(dirty, false);
});
