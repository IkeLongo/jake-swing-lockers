import test from "node:test";
import assert from "node:assert/strict";
import {
  assignStagedCurrent,
  setStagedCurrentTests,
  type ComparisonStore,
} from "@/lib/imports/stagedComparison";

interface FakeRow {
  id: number;
  importBatchId: number;
  currentSummaryId: number | null;
  includeInReport: boolean;
}

function createFakeDb(rows: FakeRow[], session = { needsRefinalization: false }) {
  const writes: Array<{ ids: number[]; current: number | null }> = [];
  const state = { rows, session, writes };
  const storeFor = (): ComparisonStore => ({
    async loadBatchSummaries(batchId) {
      return state.rows
        .filter((r) => r.importBatchId === batchId)
        .map(({ id, currentSummaryId }) => ({ id, currentSummaryId }));
    },
    async setCurrentSummaryId(ids, current) {
      writes.push({ ids: [...ids], current });
      for (const r of state.rows) if (ids.includes(r.id)) r.currentSummaryId = current;
    },
    async markSessionNeedsRefinalization() {
      state.session.needsRefinalization = true;
    },
  });
  return { state, store: storeFor() };
}

const row = (
  id: number,
  currentSummaryId: number | null = null,
  includeInReport = true,
  importBatchId = 1,
): FakeRow => ({ id, importBatchId, currentSummaryId, includeInReport });

const links = (rows: FakeRow[]) =>
  rows.filter((r) => r.currentSummaryId !== null).map((r) => [r.id, r.currentSummaryId]);

// ── Single Test → Current ────────────────────────────────────────────────────

test("assigns a Test to a Current and leaves includeInReport unchanged", async () => {
  const { state, store } = createFakeDb([row(10, null, false), row(20, null, true)]);
  const result = await assignStagedCurrent(store, 1, 20, 10);
  assert.deepEqual(result, { ok: true, testSummaryId: 20, currentSummaryId: 10, changed: true });
  assert.equal(state.rows[1]!.currentSummaryId, 10);
  assert.deepEqual(state.rows.map((r) => r.includeInReport), [false, true]);
});

test("one Current can have multiple Tests", async () => {
  const { state, store } = createFakeDb([row(10), row(20), row(21), row(22)]);
  for (const id of [20, 21, 22]) {
    assert.equal((await assignStagedCurrent(store, 1, id, 10)).ok, true);
  }
  assert.deepEqual(links(state.rows), [[20, 10], [21, 10], [22, 10]]);
});

test("a Test has one Current: re-assigning moves it", async () => {
  const { state, store } = createFakeDb([row(10), row(11), row(20, 10)]);
  const result = await assignStagedCurrent(store, 1, 20, 11);
  assert.equal(result.ok, true);
  assert.deepEqual(links(state.rows), [[20, 11]]);
});

test("unlink clears the Current and leaves includeInReport unchanged", async () => {
  const { state, store } = createFakeDb([row(10), row(20, 10, false)]);
  const result = await assignStagedCurrent(store, 1, 20, null);
  assert.deepEqual(result, { ok: true, testSummaryId: 20, currentSummaryId: null, changed: true });
  assert.equal(state.rows[1]!.currentSummaryId, null);
  assert.equal(state.rows[1]!.includeInReport, false);
});

test("self-link is rejected", async () => {
  const { state, store } = createFakeDb([row(10)]);
  const result = await assignStagedCurrent(store, 1, 10, 10);
  assert.equal(result.ok, false);
  assert.equal(state.writes.length, 0);
});

test("Current in another batch is rejected", async () => {
  const { state, store } = createFakeDb([row(10, null, true, 2), row(20)]);
  const result = await assignStagedCurrent(store, 1, 20, 10);
  assert.deepEqual(result.ok === false && result.status, 422);
  assert.equal(state.writes.length, 0);
});

test("Test summary in another batch is not found", async () => {
  const { store } = createFakeDb([row(10), row(20, null, true, 2)]);
  const result = await assignStagedCurrent(store, 1, 20, 10);
  assert.equal(result.ok === false && result.status, 404);
});

test("chain A → B → C is rejected (target is already a Test)", async () => {
  const { state, store } = createFakeDb([row(1), row(2, 1), row(3)]);
  const result = await assignStagedCurrent(store, 1, 3, 2);
  assert.equal(result.ok, false);
  assert.deepEqual(links(state.rows), [[2, 1]]);
});

test("an existing Current cannot become a Test", async () => {
  const { state, store } = createFakeDb([row(1), row(2, 1), row(3)]);
  const result = await assignStagedCurrent(store, 1, 1, 3);
  assert.equal(result.ok, false);
  assert.deepEqual(links(state.rows), [[2, 1]]);
});

test("re-assigning the same Current is a no-op and does not mark dirty", async () => {
  const { state, store } = createFakeDb([row(10), row(20, 10)]);
  const result = await assignStagedCurrent(store, 1, 20, 10);
  assert.equal(result.ok && result.changed, false);
  assert.equal(state.writes.length, 0);
  assert.equal(state.session.needsRefinalization, false);
});

test("a relationship change marks the session for re-finalization", async () => {
  const { state, store } = createFakeDb([row(10), row(20)]);
  await assignStagedCurrent(store, 1, 20, 10);
  assert.equal(state.session.needsRefinalization, true);
});

// ── Set Tests for a Current ──────────────────────────────────────────────────

test("sets one Test for a Current", async () => {
  const { state, store } = createFakeDb([row(10), row(20)]);
  const result = await setStagedCurrentTests(store, 1, 10, [20]);
  assert.deepEqual(result, { ok: true, currentSummaryId: 10, testSummaryIds: [20], changed: true });
  assert.deepEqual(links(state.rows), [[20, 10]]);
});

test("sets multiple Tests for a Current and returns ascending ids", async () => {
  const { state, store } = createFakeDb([row(10), row(20), row(21), row(22)]);
  const result = await setStagedCurrentTests(store, 1, 10, [22, 20, 21]);
  assert.deepEqual(result.ok && result.testSummaryIds, [20, 21, 22]);
  assert.deepEqual(links(state.rows), [[20, 10], [21, 10], [22, 10]]);
});

test("replaces [A, B] with [B, C]", async () => {
  const { state, store } = createFakeDb([row(10), row(20, 10), row(21, 10), row(22)]);
  const result = await setStagedCurrentTests(store, 1, 10, [21, 22]);
  assert.deepEqual(result.ok && result.testSummaryIds, [21, 22]);
  assert.deepEqual(links(state.rows), [[21, 10], [22, 10]]);
});

test("clearing all Tests is valid and deletes nothing", async () => {
  const { state, store } = createFakeDb([row(10, null, false), row(20, 10, false), row(21, 10, true)]);
  const result = await setStagedCurrentTests(store, 1, 10, []);
  assert.deepEqual(result, { ok: true, currentSummaryId: 10, testSummaryIds: [], changed: true });
  assert.equal(state.rows.length, 3);
  assert.deepEqual(links(state.rows), []);
  assert.deepEqual(state.rows.map((r) => r.includeInReport), [false, false, true]);
});

test("unrelated comparison groups are untouched", async () => {
  const { state, store } = createFakeDb([
    row(10), row(20, 10), row(21),
    row(30), row(31, 30), row(32, 30),
  ]);
  await setStagedCurrentTests(store, 1, 10, [21]);
  assert.deepEqual(links(state.rows), [[21, 10], [31, 30], [32, 30]]);
});

test("duplicate Test ids are collapsed", async () => {
  const { state, store } = createFakeDb([row(10), row(20)]);
  const result = await setStagedCurrentTests(store, 1, 10, [20, 20, 20]);
  assert.deepEqual(result.ok && result.testSummaryIds, [20]);
  assert.equal(state.writes.length, 1);
});

test("setting the same Tests again is a no-op and does not mark dirty", async () => {
  const { state, store } = createFakeDb([row(10), row(20, 10)]);
  const result = await setStagedCurrentTests(store, 1, 10, [20]);
  assert.equal(result.ok && result.changed, false);
  assert.equal(state.writes.length, 0);
  assert.equal(state.session.needsRefinalization, false);
});

test("a Test from another batch is rejected and nothing is written", async () => {
  const { state, store } = createFakeDb([row(10), row(20, 10), row(21, null, true, 2)]);
  const result = await setStagedCurrentTests(store, 1, 10, [21]);
  assert.equal(result.ok, false);
  assert.equal(state.writes.length, 0);
  assert.deepEqual(links(state.rows), [[20, 10]]);
});

test("the Current itself in the Test ids is rejected", async () => {
  const { state, store } = createFakeDb([row(10), row(20)]);
  const result = await setStagedCurrentTests(store, 1, 10, [20, 10]);
  assert.equal(result.ok, false);
  assert.equal(state.writes.length, 0);
});

test("chaining conflicts are rejected atomically", async () => {
  // 11 is a Current for 12; it cannot become a Test of 10.
  const { state, store } = createFakeDb([row(10), row(20, 10), row(21), row(11), row(12, 11)]);
  const result = await setStagedCurrentTests(store, 1, 10, [21, 11]);
  assert.equal(result.ok, false);
  assert.equal(state.writes.length, 0);
  assert.deepEqual(links(state.rows), [[20, 10], [12, 11]]);

  // A club that is itself a Test cannot be used as a Current.
  const second = await setStagedCurrentTests(store, 1, 20, [21]);
  assert.equal(second.ok, false);
  assert.equal(state.writes.length, 0);
});

test("invalid ids are rejected", async () => {
  const { store } = createFakeDb([row(10), row(20)]);
  for (const bad of [[0], [-1], [1.5], ["20"], [null]]) {
    const result = await setStagedCurrentTests(store, 1, 10, bad);
    assert.equal(result.ok, false);
  }
});

test("unknown Current is not found", async () => {
  const { store } = createFakeDb([row(20)]);
  const result = await setStagedCurrentTests(store, 1, 99, [20]);
  assert.equal(result.ok === false && result.status, 404);
});

test("set-Tests marks the session dirty only when something changes", async () => {
  const { state, store } = createFakeDb([row(10), row(20)]);
  await setStagedCurrentTests(store, 1, 10, []);
  assert.equal(state.session.needsRefinalization, false);
  await setStagedCurrentTests(store, 1, 10, [20]);
  assert.equal(state.session.needsRefinalization, true);
});

test("includeInReport is never changed by set-Tests", async () => {
  const { state, store } = createFakeDb([row(10, null, false), row(20, null, true), row(21, 10, false)]);
  await setStagedCurrentTests(store, 1, 10, [20]);
  assert.deepEqual(state.rows.map((r) => r.includeInReport), [false, true, false]);
});
