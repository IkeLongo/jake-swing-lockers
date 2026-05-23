/**
 * TrackMan Club-Level Aggregation
 *
 * Groups TrackMan shot rows (from ImportRow.rawData) by Club.Type and
 * calculates per-metric averages, ignoring blank/null/non-numeric values.
 *
 * Rules:
 * - Blank / null Club.Type → grouped as "Unassigned"
 * - Only valid finite numbers contribute to averages
 * - Blank values are NEVER treated as zero
 * - avg* is null when no valid values exist for that metric
 * - valid*Count tracks how many shots contributed to each average
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** The TrackMan fields we aggregate. Keys match column names in rawData. */
const METRIC_FIELDS = [
  "Measurement.ClubSpeed",
  "Measurement.BallSpeed",
  "Measurement.SpinRate",
  "MaxHeight.Height",
  "Measurement.Carry",
  "Measurement.Total",
] as const;

type MetricField = (typeof METRIC_FIELDS)[number];

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

// ── Aggregation ───────────────────────────────────────────────────────────────

/**
 * Group shot rows by Club.Type + Tags and return per-group average summaries.
 *
 * Rows with the same club but different tags produce separate summary rows.
 * Tags are normalized (trimmed, sorted) before grouping so that whitespace
 * differences never create phantom groups.
 *
 * @param rows - Array of rawData objects from ImportRow (or any similar
 *               Record<string, unknown> from the parsed XLSX).
 * @returns Summaries sorted alphabetically by clubName then tags, with "Unassigned" last.
 */
export function aggregateTrackManClubSummaries(
  rows: Record<string, unknown>[],
): ClubSummaryInput[] {
  // Map from composite key `${clubName}::${sortedTags.join("|")}` → accumulated data
  const groups = new Map<
    string,
    {
      originalClubName: string | null;
      clubName: string;
      tags: string[];
      shotCount: number;
      values: Record<MetricField, number[]>;
    }
  >();

  for (const row of rows) {
    const rawClub = row["Club.Type"];
    const clubStr =
      rawClub !== null && rawClub !== undefined
        ? String(rawClub).trim()
        : "";
    const isUnassigned = clubStr === "" || clubStr === "—";
    const originalClubName = isUnassigned ? null : clubStr;
    const clubName = isUnassigned ? "Unassigned" : clubStr;

    // Normalize tags: trim, filter blanks, sort for a stable group key
    const rawTags = Array.isArray(row["tags"]) ? (row["tags"] as unknown[]) : [];
    const normalizedTags = rawTags
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
        shotCount: 0,
        values: {
          "Measurement.ClubSpeed": [],
          "Measurement.BallSpeed": [],
          "Measurement.SpinRate": [],
          "MaxHeight.Height": [],
          "Measurement.Carry": [],
          "Measurement.Total": [],
        },
      });
    }

    const group = groups.get(groupKey)!;
    group.shotCount += 1;

    for (const field of METRIC_FIELDS) {
      const n = safeNumber(row[field]);
      if (n !== null) {
        group.values[field].push(n);
      }
    }
  }

  // Build output summaries
  const summaries: ClubSummaryInput[] = [];

  for (const group of groups.values()) {
    const v = group.values;
    summaries.push({
      originalClubName: group.originalClubName,
      clubName: group.clubName,
      tags: group.tags,
      shotCount: group.shotCount,

      avgClubSpeed: averageValidNumbers(v["Measurement.ClubSpeed"]),
      avgBallSpeed: averageValidNumbers(v["Measurement.BallSpeed"]),
      avgSpinRate: averageValidNumbers(v["Measurement.SpinRate"]),
      avgMaxHeight: averageValidNumbers(v["MaxHeight.Height"]),
      avgCarry: averageValidNumbers(v["Measurement.Carry"]),
      avgTotal: averageValidNumbers(v["Measurement.Total"]),

      validClubSpeedCount: v["Measurement.ClubSpeed"].length,
      validBallSpeedCount: v["Measurement.BallSpeed"].length,
      validSpinRateCount: v["Measurement.SpinRate"].length,
      validMaxHeightCount: v["MaxHeight.Height"].length,
      validCarryCount: v["Measurement.Carry"].length,
      validTotalCount: v["Measurement.Total"].length,
    });
  }

  // Sort: named clubs alphabetically, then by tags; "Unassigned" always last
  summaries.sort((a, b) => {
    if (a.clubName === "Unassigned") return 1;
    if (b.clubName === "Unassigned") return -1;
    const clubCmp = a.clubName.localeCompare(b.clubName);
    if (clubCmp !== 0) return clubCmp;
    return a.tags.join("|").localeCompare(b.tags.join("|"));
  });

  return summaries;
}
