/**
 * Pure finalization logic: turns staged ImportClubSummary rows into the
 * DemoClubTest rows to persist, using the authoritative staged relationship
 * `Test.currentSummaryId -> Current.id`. Legacy `linkedToSummaryId` is not read.
 *
 * Roles
 * - Current: a summary referenced by at least one other summary as its Current
 *   and that has no Current of its own (no chaining). It is finalized only when
 *   at least one *included* Test references it. Its own `includeInReport` is
 *   ignored.
 * - Test: an included summary. Linked to a Current when its `currentSummaryId`
 *   resolves to a valid Current in the batch, otherwise standalone (this also
 *   covers dangling or chained references).
 * - A summary referenced as a Current whose Tests are all excluded produces
 *   nothing, even if its own `includeInReport` is true.
 *
 * Ordering (deterministic, no schema support for group order):
 * - Tests inside a group are ordered by clubName (case-insensitive), then id.
 * - Groups (and standalone Tests, which are groups of one) are ordered by the
 *   clubName of their first Test, then that Test's id.
 * - `pairIndex` is the group's position starting at 0, shared by every member.
 * - `sortOrder` increases across the flattened order: Current, then its Tests,
 *   then the next group.
 */

export interface PlannableSummary {
  id: number;
  clubName: string;
  tags: unknown;
  includeInReport: boolean;
  currentSummaryId: number | null;
}

export interface PlannedComparisonGroup<S extends PlannableSummary> {
  pairIndex: number;
  current: S | null;
  tests: S[];
}

export interface PlannedClubRow<S extends PlannableSummary> {
  summary: S;
  clubRole: "current" | "demo";
  clubType: string;
  pairIndex: number;
  sortOrder: number;
  /** Index (into the same rows array) of this Test's Current row, if any. */
  currentRowIndex: number | null;
}

function compareSummaries(a: PlannableSummary, b: PlannableSummary): number {
  const an = a.clubName.toLowerCase();
  const bn = b.clubName.toLowerCase();
  if (an < bn) return -1;
  if (an > bn) return 1;
  return a.id - b.id;
}

export function planComparisonGroups<S extends PlannableSummary>(
  summaries: readonly S[],
): PlannedComparisonGroup<S>[] {
  const byId = new Map<number, S>(summaries.map((s) => [s.id, s]));

  const validCurrents = new Map<number, S>();
  for (const s of summaries) {
    if (s.currentSummaryId === null || s.currentSummaryId === s.id) continue;
    const current = byId.get(s.currentSummaryId);
    if (current && current.currentSummaryId === null) {
      validCurrents.set(current.id, current);
    }
  }

  const testsByCurrent = new Map<number, S[]>();
  const standalone: S[] = [];
  for (const s of summaries) {
    if (!s.includeInReport) continue;
    if (s.currentSummaryId !== null && validCurrents.has(s.currentSummaryId)) {
      const list = testsByCurrent.get(s.currentSummaryId) ?? [];
      list.push(s);
      testsByCurrent.set(s.currentSummaryId, list);
    } else if (!validCurrents.has(s.id)) {
      standalone.push(s);
    }
  }

  const groups: Omit<PlannedComparisonGroup<S>, "pairIndex">[] = [];
  for (const [currentId, tests] of testsByCurrent) {
    groups.push({
      current: validCurrents.get(currentId)!,
      tests: [...tests].sort(compareSummaries),
    });
  }
  for (const s of standalone) groups.push({ current: null, tests: [s] });

  groups.sort((a, b) => compareSummaries(a.tests[0]!, b.tests[0]!));
  return groups.map((g, pairIndex) => ({ ...g, pairIndex }));
}

function comparisonLabel(summary: PlannableSummary): string {
  const tags = Array.isArray(summary.tags) ? (summary.tags as string[]) : [];
  return tags.length > 0
    ? `${summary.clubName} - ${tags.join(", ")}`
    : summary.clubName;
}

export function flattenPlan<S extends PlannableSummary>(
  groups: readonly PlannedComparisonGroup<S>[],
): PlannedClubRow<S>[] {
  const rows: PlannedClubRow<S>[] = [];
  for (const group of groups) {
    let currentRowIndex: number | null = null;
    if (group.current) {
      currentRowIndex = rows.length;
      rows.push({
        summary: group.current,
        clubRole: "current",
        clubType: comparisonLabel(group.current),
        pairIndex: group.pairIndex,
        sortOrder: rows.length,
        currentRowIndex: null,
      });
    }
    for (const test of group.tests) {
      rows.push({
        summary: test,
        clubRole: "demo",
        clubType: test.clubName,
        pairIndex: group.pairIndex,
        sortOrder: rows.length,
        currentRowIndex,
      });
    }
  }
  return rows;
}

export interface FinalizeStore<S extends PlannableSummary> {
  listClubs(sessionId: number): Promise<{ id: number; currentClubTestId: number | null }[]>;
  deleteMetrics(clubIds: number[]): Promise<void>;
  deleteClubs(clubIds: number[]): Promise<void>;
  createClub(
    sessionId: number,
    row: PlannedClubRow<S>,
    currentClubTestId: number | null,
  ): Promise<number>;
  createMetrics(clubId: number, summary: S): Promise<void>;
}

/** Deletes Tests before Currents so the self-FK never has to SetNull rows mid-delete. */
export async function deleteSessionClubs<S extends PlannableSummary>(
  store: FinalizeStore<S>,
  sessionId: number,
): Promise<void> {
  const clubs = await store.listClubs(sessionId);
  if (clubs.length === 0) return;
  await store.deleteMetrics(clubs.map((c) => c.id));
  const tests = clubs.filter((c) => c.currentClubTestId !== null).map((c) => c.id);
  const rest = clubs.filter((c) => c.currentClubTestId === null).map((c) => c.id);
  if (tests.length > 0) await store.deleteClubs(tests);
  if (rest.length > 0) await store.deleteClubs(rest);
}

/** Creates each Current exactly once, then its Tests pointing at it. */
export async function persistPlan<S extends PlannableSummary>(
  store: FinalizeStore<S>,
  sessionId: number,
  rows: readonly PlannedClubRow<S>[],
): Promise<void> {
  const createdIds: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const currentClubTestId =
      row.currentRowIndex !== null ? createdIds[row.currentRowIndex]! : null;
    const id = await store.createClub(sessionId, row, currentClubTestId);
    await store.createMetrics(id, row.summary);
    createdIds.push(id);
  }
}
