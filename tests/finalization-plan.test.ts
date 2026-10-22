import test from "node:test";
import assert from "node:assert/strict";
import {
  deleteSessionClubs,
  flattenPlan,
  persistPlan,
  planComparisonGroups,
  type FinalizeStore,
  type PlannableSummary,
  type PlannedClubRow,
} from "@/lib/imports/finalizationPlan";

interface S extends PlannableSummary {
  price: number | null;
}

const s = (
  id: number,
  clubName: string,
  o: Partial<S> = {},
): S => ({
  id,
  clubName,
  tags: [],
  includeInReport: true,
  currentSummaryId: null,
  price: null,
  ...o,
});

const plan = (summaries: S[]) => flattenPlan(planComparisonGroups(summaries));
const summary = (r: PlannedClubRow<S>) => r.summary.id;

test("one Current + one Test", () => {
  const rows = plan([s(10, "Mine", { includeInReport: false }), s(20, "XXIO", { currentSummaryId: 10 })]);
  assert.deepEqual(rows.map((r) => [summary(r), r.clubRole, r.pairIndex, r.sortOrder]), [
    [10, "current", 0, 0],
    [20, "demo", 0, 1],
  ]);
  assert.equal(rows[0]!.currentRowIndex, null);
  assert.equal(rows[1]!.currentRowIndex, 0);
});

test("one Current + many Tests: Current appears once, Tests share pairIndex", () => {
  const rows = plan([
    s(10, "Mine"),
    s(22, "C", { currentSummaryId: 10 }),
    s(20, "A", { currentSummaryId: 10 }),
    s(21, "B", { currentSummaryId: 10 }),
  ]);
  assert.equal(rows.filter((r) => r.clubRole === "current").length, 1);
  assert.deepEqual(rows.map(summary), [10, 20, 21, 22]);
  assert.ok(rows.every((r) => r.pairIndex === 0));
  assert.deepEqual(rows.slice(1).map((r) => r.currentRowIndex), [0, 0, 0]);
});

test("multiple groups and standalone get sequential pairIndex from 0, ordered by first Test name", () => {
  const rows = plan([
    s(1, "Cur B"),
    s(2, "B1", { currentSummaryId: 1 }),
    s(3, "Cur A"),
    s(4, "A1", { currentSummaryId: 3 }),
    s(5, "A2", { currentSummaryId: 3 }),
    s(6, "Solo C"),
  ]);
  assert.deepEqual(
    rows.map((r) => [summary(r), r.pairIndex, r.sortOrder]),
    [
      [3, 0, 0], [4, 0, 1], [5, 0, 2],
      [1, 1, 3], [2, 1, 4],
      [6, 2, 5],
    ],
  );
  const solo = rows.find((r) => summary(r) === 6)!;
  assert.equal(solo.clubRole, "demo");
  assert.equal(solo.currentRowIndex, null);
});

test("excluded Test is skipped and not unlinked", () => {
  const input = [
    s(10, "Mine"),
    s(20, "In", { currentSummaryId: 10 }),
    s(21, "Out", { currentSummaryId: 10, includeInReport: false }),
  ];
  const rows = plan(input);
  assert.deepEqual(rows.map(summary), [10, 20]);
  assert.equal(input[2]!.currentSummaryId, 10);
  assert.equal(input[2]!.includeInReport, false);
});

test("Current whose Tests are all excluded is skipped, even if included itself", () => {
  const rows = plan([
    s(10, "Mine", { includeInReport: true }),
    s(20, "Out", { currentSummaryId: 10, includeInReport: false }),
    s(30, "Solo"),
  ]);
  assert.deepEqual(rows.map(summary), [30]);
});

test("Current with includeInReport false is still finalized when a Test is included", () => {
  const rows = plan([s(10, "Mine", { includeInReport: false }), s(20, "T", { currentSummaryId: 10 })]);
  assert.deepEqual(rows.map(summary), [10, 20]);
});

test("nothing included yields no rows", () => {
  assert.deepEqual(plan([s(1, "x", { includeInReport: false })]), []);
});

test("Current label uses tags; Test label is club name; legacy linkedToSummaryId is ignored", () => {
  const rows = plan([
    s(10, "Mine", { tags: ["Stiff", "Old"] }),
    s(20, "XXIO", { currentSummaryId: 10, tags: ["x"] }),
    { ...s(30, "Legacy"), linkedToSummaryId: 40 } as S,
    s(40, "Legacy2"),
  ]);
  assert.equal(rows.find((r) => summary(r) === 10)!.clubType, "Mine - Stiff, Old");
  assert.equal(rows.find((r) => summary(r) === 20)!.clubType, "XXIO");
  // 30 and 40 are unrelated standalone Tests under the new model
  assert.deepEqual(
    rows.filter((r) => [30, 40].includes(summary(r))).map((r) => [summary(r), r.clubRole]),
    [
      [30, "demo"],
      [40, "demo"],
    ],
  );
});

test("dangling or chained references degrade to standalone Tests", () => {
  const rows = plan([
    s(1, "Dangling", { currentSummaryId: 999 }),
    s(2, "Cur"),
    s(3, "Mid", { currentSummaryId: 2 }),
    s(4, "Leaf", { currentSummaryId: 3 }),
  ]);
  assert.deepEqual(
    rows.map((r) => [summary(r), r.clubRole, r.currentRowIndex]),
    [
      [1, "demo", null],
      [4, "demo", null],
      [2, "current", null],
      [3, "demo", 2],
    ],
  );
});

// ── persistence / re-finalization ────────────────────────────────────────────

function fakeStore(existing: { id: number; currentClubTestId: number | null }[] = []) {
  const log: string[] = [];
  const created: { id: number; row: PlannedClubRow<S>; currentClubTestId: number | null }[] = [];
  const metrics: { clubId: number; summaryId: number }[] = [];
  let nextId = 100;
  const store: FinalizeStore<S> = {
    async listClubs() {
      return existing;
    },
    async deleteMetrics(ids) {
      log.push(`metrics:${ids.join(",")}`);
    },
    async deleteClubs(ids) {
      log.push(`clubs:${ids.join(",")}`);
    },
    async createClub(_sid, row, currentClubTestId) {
      const id = nextId++;
      created.push({ id, row, currentClubTestId });
      return id;
    },
    async createMetrics(clubId, sum) {
      metrics.push({ clubId, summaryId: sum.id });
    },
  };
  return { store, log, created, metrics };
}

test("persistPlan creates Current once, Tests point at it, metrics stay per club", async () => {
  const rows = plan([
    s(10, "Mine"),
    s(20, "A", { currentSummaryId: 10 }),
    s(21, "B", { currentSummaryId: 10 }),
    s(30, "Solo"),
  ]);
  const { store, created, metrics } = fakeStore();
  await persistPlan(store, 1, rows);

  assert.deepEqual(
    created.map((c) => [c.id, c.row.clubRole, c.currentClubTestId, c.row.pairIndex]),
    [
      [100, "current", null, 0],
      [101, "demo", 100, 0],
      [102, "demo", 100, 0],
      [103, "demo", null, 1],
    ],
  );
  assert.deepEqual(metrics, [
    { clubId: 100, summaryId: 10 },
    { clubId: 101, summaryId: 20 },
    { clubId: 102, summaryId: 21 },
    { clubId: 103, summaryId: 30 },
  ]);
});

test("persistPlan preserves per-club price source (summary passed through)", async () => {
  const rows = plan([s(10, "Mine", { price: 1 }), s(20, "A", { currentSummaryId: 10, price: 2 })]);
  const { store, created } = fakeStore();
  await persistPlan(store, 1, rows);
  assert.deepEqual(created.map((c) => c.row.summary.price), [1, 2]);
});

test("re-finalization deletes metrics, then Tests, then Currents", async () => {
  const { store, log } = fakeStore([
    { id: 1, currentClubTestId: null },
    { id: 2, currentClubTestId: 1 },
    { id: 3, currentClubTestId: 1 },
    { id: 4, currentClubTestId: null },
  ]);
  await deleteSessionClubs(store, 7);
  assert.deepEqual(log, ["metrics:1,2,3,4", "clubs:2,3", "clubs:1,4"]);
});

test("re-finalization with no existing clubs deletes nothing", async () => {
  const { store, log } = fakeStore([]);
  await deleteSessionClubs(store, 7);
  assert.deepEqual(log, []);
});
