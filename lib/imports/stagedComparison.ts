/**
 * Staged comparison relationships on ImportClubSummary.
 *
 * Authoritative representation: TEST.currentSummaryId = CURRENT.id.
 * (The legacy linkedToSummaryId column is NOT read or written here.)
 *
 * Roles are derived, never stored:
 * - a Test is a summary whose currentSummaryId is set;
 * - a Current is a summary referenced by at least one Test.
 * One Current may be referenced by many Tests; a Test has at most one Current.
 * A summary cannot be both (no chains).
 *
 * includeInReport is intentionally never touched by anything in this module.
 */

export interface StagedComparisonRow {
  id: number;
  currentSummaryId: number | null;
}

export interface ComparisonStore {
  /**
   * Returns every summary in the batch. Implementations used inside a
   * transaction must lock these rows so concurrent edits serialize.
   */
  loadBatchSummaries(batchId: number): Promise<StagedComparisonRow[]>;
  setCurrentSummaryId(
    summaryIds: number[],
    currentSummaryId: number | null,
  ): Promise<void>;
  /** Flags a finalized session as needing re-finalization (no-op otherwise). */
  markSessionNeedsRefinalization(batchId: number): Promise<void>;
}

export type ComparisonFailure = { ok: false; status: 404 | 422; error: string };

export type AssignCurrentResult =
  | { ok: true; testSummaryId: number; currentSummaryId: number | null; changed: boolean }
  | ComparisonFailure;

export type SetTestsResult =
  | {
      ok: true;
      currentSummaryId: number;
      /** Authoritative Test ids for this Current after the update, ascending. */
      testSummaryIds: number[];
      changed: boolean;
    }
  | ComparisonFailure;

function fail(status: 404 | 422, error: string): ComparisonFailure {
  return { ok: false, status, error };
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * Assigns one Test to a Current, or clears its Current when currentSummaryId
 * is null. A Test that already has a different Current is moved.
 */
export async function assignStagedCurrent(
  store: ComparisonStore,
  batchId: number,
  testSummaryId: number,
  currentSummaryId: number | null,
): Promise<AssignCurrentResult> {
  const rows = await store.loadBatchSummaries(batchId);
  const byId = new Map(rows.map((row) => [row.id, row]));

  const test = byId.get(testSummaryId);
  if (!test) return fail(404, "Club summary not found.");

  if (currentSummaryId === null) {
    const changed = test.currentSummaryId !== null;
    if (changed) {
      await store.setCurrentSummaryId([testSummaryId], null);
      await store.markSessionNeedsRefinalization(batchId);
    }
    return { ok: true, testSummaryId, currentSummaryId: null, changed };
  }

  if (!isPositiveInteger(currentSummaryId)) {
    return fail(422, "currentSummaryId must be a positive integer or null.");
  }
  if (currentSummaryId === testSummaryId) {
    return fail(422, "A summary cannot be compared against itself.");
  }

  const current = byId.get(currentSummaryId);
  if (!current) {
    return fail(422, "Current summary not found in this batch.");
  }
  if (current.currentSummaryId !== null) {
    return fail(
      422,
      "That club is already a Test for another Current and cannot be used as a Current (no chaining).",
    );
  }
  if (rows.some((row) => row.currentSummaryId === testSummaryId)) {
    return fail(
      422,
      "This club is already the Current for other Tests and cannot also be a Test (no chaining).",
    );
  }

  const changed = test.currentSummaryId !== currentSummaryId;
  if (changed) {
    await store.setCurrentSummaryId([testSummaryId], currentSummaryId);
    await store.markSessionNeedsRefinalization(batchId);
  }
  return { ok: true, testSummaryId, currentSummaryId, changed };
}

/**
 * Sets the complete list of Tests for one Current. Every request is validated
 * before any write, so a rejected request changes nothing. Duplicate ids are
 * collapsed. Tests currently assigned to a different Current are moved; other
 * groups are otherwise untouched.
 */
export async function setStagedCurrentTests(
  store: ComparisonStore,
  batchId: number,
  currentSummaryId: number,
  requestedTestIds: readonly unknown[],
): Promise<SetTestsResult> {
  const testIds: number[] = [];
  for (const raw of requestedTestIds) {
    if (!isPositiveInteger(raw)) {
      return fail(422, "testSummaryIds must be an array of positive integers.");
    }
    if (!testIds.includes(raw)) testIds.push(raw);
  }

  const rows = await store.loadBatchSummaries(batchId);
  const byId = new Map(rows.map((row) => [row.id, row]));

  const current = byId.get(currentSummaryId);
  if (!current) return fail(404, "Club summary not found.");

  if (testIds.includes(currentSummaryId)) {
    return fail(422, "A summary cannot be compared against itself.");
  }

  for (const testId of testIds) {
    if (!byId.has(testId)) {
      return fail(422, `Test summary ${testId} not found in this batch.`);
    }
  }

  if (testIds.length > 0) {
    if (current.currentSummaryId !== null) {
      return fail(
        422,
        "That club is already a Test for another Current and cannot be used as a Current (no chaining).",
      );
    }
    for (const testId of testIds) {
      if (rows.some((row) => row.currentSummaryId === testId)) {
        return fail(
          422,
          `Summary ${testId} is already the Current for other Tests and cannot also be a Test (no chaining).`,
        );
      }
    }
  }

  const selected = new Set(testIds);
  const toAssign = testIds.filter(
    (id) => byId.get(id)!.currentSummaryId !== currentSummaryId,
  );
  const toRemove = rows
    .filter(
      (row) =>
        row.currentSummaryId === currentSummaryId && !selected.has(row.id),
    )
    .map((row) => row.id);

  if (toRemove.length > 0) {
    await store.setCurrentSummaryId(toRemove, null);
  }
  if (toAssign.length > 0) {
    await store.setCurrentSummaryId(toAssign, currentSummaryId);
  }

  const changed = toAssign.length > 0 || toRemove.length > 0;
  if (changed) await store.markSessionNeedsRefinalization(batchId);

  return {
    ok: true,
    currentSummaryId,
    testSummaryIds: [...testIds].sort((a, b) => a - b),
    changed,
  };
}
