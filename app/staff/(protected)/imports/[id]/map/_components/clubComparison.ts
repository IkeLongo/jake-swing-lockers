import type { SerializedClubSummary } from "./clubSummaryTypes";

function isValidSummaryId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function getCurrentForTest(
  summaries: readonly SerializedClubSummary[],
  test: SerializedClubSummary,
): SerializedClubSummary | null {
  const currentId = test.currentSummaryId;
  if (!isValidSummaryId(currentId) || currentId === test.id) return null;

  const current = summaries.find((summary) => summary.id === currentId);
  return current?.currentSummaryId === null ? current : null;
}

export function getTestsForCurrent(
  summaries: readonly SerializedClubSummary[],
  currentId: number,
): SerializedClubSummary[] {
  if (!isValidSummaryId(currentId)) return [];

  const current = summaries.find((summary) => summary.id === currentId);
  if (!current || current.currentSummaryId !== null) return [];

  return summaries.filter(
    (summary) => getCurrentForTest(summaries, summary)?.id === currentId,
  );
}

export function canSelectTest(
  summaries: readonly SerializedClubSummary[],
  currentId: number,
  testId: number,
): boolean {
  if (currentId === testId) return false;

  const current = summaries.find((summary) => summary.id === currentId);
  const test = summaries.find((summary) => summary.id === testId);
  return Boolean(
    current &&
      current.currentSummaryId === null &&
      test &&
    !summaries.some((summary) => summary.currentSummaryId === testId),
  );
}

export function reconcileCurrentTests(
  summaries: readonly SerializedClubSummary[],
  currentId: number,
  testIds: readonly number[],
): SerializedClubSummary[] {
  const selectedIds = new Set(testIds);
  return summaries.map((summary) => {
    if (summary.id === currentId) return summary;
    if (selectedIds.has(summary.id)) {
      return { ...summary, currentSummaryId: currentId };
    }
    if (summary.currentSummaryId === currentId) {
      return { ...summary, currentSummaryId: null };
    }
    return summary;
  });
}

export function shouldMarkComparisonDirty(
  changed: boolean,
  finalized: boolean,
): boolean {
  return changed && finalized;
}

export interface SetCurrentTestsResponse {
  success: true;
  currentSummaryId: number;
  testSummaryIds: number[];
  changed: boolean;
}

export function isSetCurrentTestsResponse(
  value: unknown,
  expectedCurrentId: number,
): value is SetCurrentTestsResponse {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const response = value as Record<string, unknown>;
  return (
    response.success === true &&
    response.currentSummaryId === expectedCurrentId &&
    Array.isArray(response.testSummaryIds) &&
    response.testSummaryIds.every(isValidSummaryId) &&
    !response.testSummaryIds.includes(expectedCurrentId) &&
    new Set(response.testSummaryIds).size === response.testSummaryIds.length &&
    typeof response.changed === "boolean"
  );
}
