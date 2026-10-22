/**
 * Interprets finalized DemoClubTest rows as comparison groups:
 * `{ current, tests[] }`.
 *
 * Two representations are supported:
 *
 * 1. Explicit (newly finalized data): a Test (`clubRole === "demo"`) whose
 *    `currentClubTestId` points at a Current (`clubRole === "current"`) in the
 *    same row set. `currentClubTestId` is authoritative; one Current may have
 *    many Tests.
 * 2. Legacy (historical/manual data): rows without a resolvable reference are
 *    grouped by `pairIndex`. `pairIndex = 0` is a valid group.
 *
 * Rules for malformed data (all deterministic for rows passed in the same order;
 * callers pass rows ordered by `sortOrder`):
 * - Tests are never dropped. Multiple Tests in a group are kept in input order.
 * - A Test whose `currentClubTestId` does not resolve to a Current in the row
 *   set falls back to legacy `pairIndex` grouping. If an explicit group already
 *   uses that `pairIndex` it joins that group's Tests; otherwise it forms a
 *   legacy group.
 * - Multiple Currents in one legacy `pairIndex` group: the first in input order
 *   wins and the rest are ignored.
 * - Rows with any other `clubRole` are ignored.
 *
 * Groups are returned sorted by `pairIndex`, ties keep input order.
 */

export interface GroupableClub {
  id?: number;
  clubRole: string;
  pairIndex: number;
  currentClubTestId?: number | null;
}

export interface FinalizedComparisonGroup<T extends GroupableClub> {
  pairIndex: number;
  current: T | null;
  tests: T[];
}

export function groupFinalizedClubs<T extends GroupableClub>(
  clubs: readonly T[],
): FinalizedComparisonGroup<T>[] {
  const currentsById = new Map<number, T>();
  for (const club of clubs) {
    if (club.clubRole === "current" && club.id !== undefined) {
      if (!currentsById.has(club.id)) currentsById.set(club.id, club);
    }
  }

  const explicit = new Map<number, FinalizedComparisonGroup<T>>();
  const legacy: T[] = [];

  for (const club of clubs) {
    if (club.clubRole !== "demo" && club.clubRole !== "current") continue;

    if (club.clubRole === "demo") {
      const ref = club.currentClubTestId;
      const current = ref != null ? currentsById.get(ref) : undefined;
      if (current) {
        let group = explicit.get(current.id!);
        if (!group) {
          group = { pairIndex: current.pairIndex, current, tests: [] };
          explicit.set(current.id!, group);
        }
        group.tests.push(club);
        continue;
      }
    }
    legacy.push(club);
  }

  const explicitGroups = Array.from(explicit.values());
  const groups: FinalizedComparisonGroup<T>[] = [...explicitGroups];
  const legacyByPairIndex = new Map<number, FinalizedComparisonGroup<T>>();

  for (const club of legacy) {
    // A Current anchoring an explicit group is already placed.
    if (club.id !== undefined && explicit.has(club.id)) continue;

    let group = legacyByPairIndex.get(club.pairIndex);
    if (!group) {
      group =
        club.clubRole === "demo"
          ? explicitGroups.find((g) => g.pairIndex === club.pairIndex)
          : undefined;
      if (!group) {
        group = { pairIndex: club.pairIndex, current: null, tests: [] };
        groups.push(group);
      }
      legacyByPairIndex.set(club.pairIndex, group);
    }

    if (club.clubRole === "demo") group.tests.push(club);
    else if (group.current === null) group.current = club;
  }

  return groups
    .map((group, index) => ({ group, index }))
    .sort((a, b) => a.group.pairIndex - b.group.pairIndex || a.index - b.index)
    .map(({ group }) => group);
}
