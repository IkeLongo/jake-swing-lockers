import test from "node:test";
import assert from "node:assert/strict";
import {
  canSelectTest,
  getComparisonGroupForSummary,
  getCurrentForTest,
  getTestsForCurrent,
  reconcileCurrentTests,
  shouldMarkComparisonDirty,
} from "@/app/staff/(protected)/imports/[id]/map/_components/clubComparison";
import type { SerializedClubSummary } from "@/app/staff/(protected)/imports/[id]/map/_components/clubSummaryTypes";

const summary = (
  id: number,
  currentSummaryId: number | null = null,
): SerializedClubSummary => ({
    id,
    importBatchId: 1,
    originalClubName: null,
    clubName: `Club ${id}`,
    tags: [],
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
    isManuallyEdited: false,
    includeInReport: true,
    estimatedPrice: null,
    currentSummaryId,
  });

test("derives multiple Tests for one Current", () => {
  const summaries = [
    summary(10),
    summary(20, 10),
    summary(21, 10),
    summary(22, 10),
  ];

  assert.deepEqual(
    getTestsForCurrent(summaries, 10).map(({ id }) => id),
    [20, 21, 22],
  );
});

test("an unlinked summary opens as a single-club group", () => {
  const summaries = [summary(10), summary(20, 10), summary(30)];

  assert.deepEqual(
    getComparisonGroupForSummary(summaries, 30).map(({ id }) => id),
    [30],
  );
});

test("opening a Current resolves one linked Test", () => {
  const summaries = [summary(10), summary(20, 10), summary(30)];

  assert.deepEqual(
    getComparisonGroupForSummary(summaries, 10).map(({ id }) => id),
    [10, 20],
  );
});

test("opening a Current resolves its Current and one or multiple Tests only", () => {
  const summaries = [
    summary(10),
    summary(20, 10),
    summary(21, 10),
    summary(22, 10),
    summary(30),
  ];

  assert.deepEqual(
    getComparisonGroupForSummary(summaries, 10).map(({ id }) => id),
    [10, 20, 21, 22],
  );
});

test("opening any linked Test resolves the same complete comparison group", () => {
  const summaries = [
    summary(10),
    summary(20, 10),
    summary(21, 10),
    summary(30),
  ];
  const expectedIds = [10, 20, 21];

  assert.deepEqual(
    getComparisonGroupForSummary(summaries, 20).map(({ id }) => id),
    expectedIds,
  );
  assert.deepEqual(
    getComparisonGroupForSummary(summaries, 21).map(({ id }) => id),
    expectedIds,
  );
});

test("derives a Test's Current", () => {
  const current = summary(11);
  const testSummary = summary(30, 11);

  assert.equal(getCurrentForTest([current, testSummary], testSummary), current);
});

test("standalone summary has no Current", () => {
  const standalone = summary(40);

  assert.equal(getCurrentForTest([standalone], standalone), null);
});

test("a summary with no Tests is not a Current role by itself", () => {
  const summaries = [summary(50)];

  assert.deepEqual(getTestsForCurrent(summaries, 50), []);
});

test("missing and chained Current references are ignored safely", () => {
  const missingCurrentTest = summary(60, 999);
  const chainedCurrent = summary(70, 60);
  const chainedTest = summary(71, 70);
  const summaries = [missingCurrentTest, chainedCurrent, chainedTest, summary(80)];

  assert.equal(getCurrentForTest(summaries, missingCurrentTest), null);
  assert.equal(getCurrentForTest(summaries, chainedTest), null);
  assert.deepEqual(getTestsForCurrent(summaries, 60), []);
  assert.equal(canSelectTest(summaries, 80, 70), false);
});

test("reconciliation assigns all server-confirmed Tests", () => {
  const summaries = [summary(10), summary(20), summary(21), summary(22)];
  const updated = reconcileCurrentTests(summaries, 10, [20, 21, 22]);

  assert.deepEqual(
    getTestsForCurrent(updated, 10).map(({ id }) => id),
    [20, 21, 22],
  );
});

test("reconciliation removes Tests omitted from the server response", () => {
  const summaries = [summary(10), summary(20, 10), summary(21, 10)];
  const updated = reconcileCurrentTests(summaries, 10, [21]);

  assert.equal(updated.find(({ id }) => id === 20)?.currentSummaryId, null);
  assert.equal(updated.find(({ id }) => id === 21)?.currentSummaryId, 10);
});

test("reconciliation moves a Test from another Current", () => {
  const summaries = [summary(10), summary(11), summary(20, 10)];
  const updated = reconcileCurrentTests(summaries, 11, [20]);

  assert.equal(updated.find(({ id }) => id === 20)?.currentSummaryId, 11);
  assert.deepEqual(getTestsForCurrent(updated, 10), []);
  assert.deepEqual(
    getTestsForCurrent(updated, 11).map(({ id }) => id),
    [20],
  );
});

test("reconciliation preserves inclusion and other summary properties", () => {
  const excludedTest = { ...summary(20, 10), includeInReport: false };
  const includedTest = { ...summary(21), includeInReport: true };
  const summaries = [summary(10, null), excludedTest, includedTest];
  const updated = reconcileCurrentTests(summaries, 10, [21]);

  assert.equal(updated.find(({ id }) => id === 20)?.currentSummaryId, null);
  assert.equal(updated.find(({ id }) => id === 20)?.includeInReport, false);
  assert.equal(updated.find(({ id }) => id === 21)?.currentSummaryId, 10);
  assert.equal(updated.find(({ id }) => id === 21)?.includeInReport, true);
  assert.equal(updated.find(({ id }) => id === 21)?.clubName, includedTest.clubName);
});

test("empty server response clears the Current group", () => {
  const summaries = [summary(10), summary(20, 10), summary(21, 10)];
  const updated = reconcileCurrentTests(summaries, 10, []);

  assert.deepEqual(getTestsForCurrent(updated, 10), []);
  assert.equal(updated.find(({ id }) => id === 20)?.currentSummaryId, null);
  assert.equal(updated.find(({ id }) => id === 21)?.currentSummaryId, null);
});

test("candidate eligibility prevents self-links and chain creation", () => {
  const summaries = [
    summary(10),
    summary(11),
    summary(20, 11),
    summary(30, 10),
    summary(31),
    summary(32, 31),
  ];

  assert.equal(canSelectTest(summaries, 10, 10), false);
  assert.equal(canSelectTest(summaries, 10, 11), false);
  assert.equal(canSelectTest(summaries, 10, 20), true);
  assert.equal(canSelectTest(summaries, 10, 30), true);
  assert.equal(canSelectTest(summaries, 30, 11), false);
  assert.equal(canSelectTest(summaries, 10, 31), false);
  assert.equal(canSelectTest(summaries, 10, 32), true);
  assert.equal(canSelectTest(summaries, 30, 32), false);
});

test("changed false does not newly dirty local state", () => {
  assert.equal(shouldMarkComparisonDirty(false, true), false);
  assert.equal(shouldMarkComparisonDirty(true, true), true);
  assert.equal(shouldMarkComparisonDirty(true, false), false);
});
