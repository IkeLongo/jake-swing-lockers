/**
 * TrackMan Club-Level Aggregation
 *
 * Groups shot rows through the application-owned shot reader and calculates
 * the existing summary metrics, ignoring blank/null/non-numeric values.
 *
 * Rules:
 * - Blank / null club type → grouped as "Unassigned"
 * - Only valid finite numbers contribute to averages
 * - Blank values are NEVER treated as zero
 * - avg* is null when no valid values exist for that metric
 * - valid*Count tracks how many shots contributed to each average
 */
import { readGolfShotMeasurements } from "./golfShotMeasurements";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Normalized summary for one club+tags group, ready to be inserted into ImportClubSummary. */
export interface ClubSummaryInput {
  originalClubName: string | null;
  clubName: string;
  /** Sorted, trimmed tag values for this group. Empty array when no tags present. */
  tags: string[];
  shotCount: number;

  avgClubSpeed: number | null;
  avgBallSpeed: number | null;
  avgSpinRate: number | null;
  avgMaxHeight: number | null;
  avgCarry: number | null;
  avgTotal: number | null;

  validClubSpeedCount: number;
  validBallSpeedCount: number;
  validSpinRateCount: number;
  validMaxHeightCount: number;
  validCarryCount: number;
  validTotalCount: number;
}

export interface TrackManSummaryMetrics {
  shotCount: number;
  avgClubSpeed: number | null;
  avgBallSpeed: number | null;
  avgSpinRate: number | null;
  avgMaxHeight: number | null;
  avgCarry: number | null;
  avgTotal: number | null;
  validClubSpeedCount: number;
  validBallSpeedCount: number;
  validSpinRateCount: number;
  validMaxHeightCount: number;
  validCarryCount: number;
  validTotalCount: number;
}

export interface ClubSummaryGroup {
  summary: ClubSummaryInput;
  rowIndexes: number[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse a cell value from rawData as a finite number.
 * Returns null for blank, "—", whitespace-only, or non-numeric values.
 * Never coerces blank to zero.
 */
export function safeNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (str === "" || str === "—" || str === "-" || str.toLowerCase() === "nan")
    return null;
  const n = parseFloat(str);
  return isFinite(n) ? n : null;
}

/**
 * Compute the arithmetic mean of an array of numbers.
 * Returns null when the array is empty.
 */
export function averageValidNumbers(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Calculate summary metrics from shot rows without using their club or tag
 * fields. This also supports recalculation after the rows have been associated
 * with a summary independently of editable display fields.
 */
export function calculateTrackManSummaryMetrics(
  rows: readonly Record<string, unknown>[],
): TrackManSummaryMetrics {
  const values = {
    clubSpeed: [] as number[],
    ballSpeed: [] as number[],
    spinRate: [] as number[],
    maxHeight: [] as number[],
    carry: [] as number[],
    total: [] as number[],
  };

  for (const row of rows) {
    const metrics = readGolfShotMeasurements(row).summaryMetrics;
    for (const key of Object.keys(values) as (keyof typeof values)[]) {
      const value = metrics[key];
      if (value !== null) values[key].push(value);
    }
  }

  return {
    shotCount: rows.length,
    avgClubSpeed: averageValidNumbers(values.clubSpeed),
    avgBallSpeed: averageValidNumbers(values.ballSpeed),
    avgSpinRate: averageValidNumbers(values.spinRate),
    avgMaxHeight: averageValidNumbers(values.maxHeight),
    avgCarry: averageValidNumbers(values.carry),
    avgTotal: averageValidNumbers(values.total),
    validClubSpeedCount: values.clubSpeed.length,
    validBallSpeedCount: values.ballSpeed.length,
    validSpinRateCount: values.spinRate.length,
    validMaxHeightCount: values.maxHeight.length,
    validCarryCount: values.carry.length,
    validTotalCount: values.total.length,
  };
}

// ── Aggregation ───────────────────────────────────────────────────────────────

/**
 * Group shot rows by club type + tags and return per-group summaries and the
 * input row indexes that belong to each group.
 *
 * Rows with the same club but different tags produce separate summary rows.
 * Tags are normalized (trimmed, sorted) before grouping so that whitespace
 * differences never create phantom groups.
 *
 * @param rows - Array of ImportRow rawData objects.
 * @returns Groups sorted alphabetically by clubName then tags, with "Unassigned" last.
 */
export function aggregateTrackManClubGroups(
  rows: readonly Record<string, unknown>[],
): ClubSummaryGroup[] {
  // Map from composite key `${clubName}::${sortedTags.join("|")}` → accumulated data
  const groups = new Map<
    string,
    {
      originalClubName: string | null;
      clubName: string;
      tags: string[];
      rows: Record<string, unknown>[];
      rowIndexes: number[];
    }
  >();

  for (const [rowIndex, row] of rows.entries()) {
    const shot = readGolfShotMeasurements(row);
    const rawClub = shot.clubType;
    const clubStr =
      rawClub !== null && rawClub !== undefined
        ? String(rawClub).trim()
        : "";
    const isUnassigned = clubStr === "" || clubStr === "—";
    const originalClubName = isUnassigned ? null : clubStr;
    const clubName = isUnassigned ? "Unassigned" : clubStr;

    // Normalize tags: trim, filter blanks, sort for a stable group key
    const normalizedTags = shot.tags
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .sort();

    const groupKey = `${clubName}::${normalizedTags.join("|")}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        originalClubName,
        clubName,
        tags: normalizedTags,
        rows: [],
        rowIndexes: [],
      });
    }

    const group = groups.get(groupKey)!;
    group.rows.push(row);
    group.rowIndexes.push(rowIndex);
  }

  const summaries: ClubSummaryGroup[] = Array.from(groups.values(), (group) => ({
    summary: {
      originalClubName: group.originalClubName,
      clubName: group.clubName,
      tags: group.tags,
      ...calculateTrackManSummaryMetrics(group.rows),
    },
    rowIndexes: group.rowIndexes,
  }));

  // Sort: named clubs alphabetically, then by tags; "Unassigned" always last
  summaries.sort((a, b) => {
    if (a.summary.clubName === "Unassigned") return 1;
    if (b.summary.clubName === "Unassigned") return -1;
    const clubCmp = a.summary.clubName.localeCompare(b.summary.clubName);
    if (clubCmp !== 0) return clubCmp;
    return a.summary.tags.join("|").localeCompare(b.summary.tags.join("|"));
  });

  return summaries;
}

/**
 * Group shot rows and return their summaries, preserving the original public
 * result shape for existing callers.
 */
export function aggregateTrackManClubSummaries(
  rows: readonly Record<string, unknown>[],
): ClubSummaryInput[] {
  return aggregateTrackManClubGroups(rows).map((group) => group.summary);
}
