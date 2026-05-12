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

/** Normalized summary for one club, ready to be inserted into ImportClubSummary. */
export interface ClubSummaryInput {
  originalClubName: string | null;
  clubName: string;
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
 * Group shot rows by Club.Type and return per-club average summaries.
 *
 * @param rows - Array of rawData objects from ImportRow (or any similar
 *               Record<string, unknown> from the parsed XLSX).
 * @returns Summaries sorted alphabetically by clubName, with "Unassigned" last.
 */
export function aggregateTrackManClubSummaries(
  rows: Record<string, unknown>[],
): ClubSummaryInput[] {
  // Map from originalClubName (or "Unassigned") → accumulated metric arrays
  const groups = new Map<
    string,
    {
      originalClubName: string | null;
      clubName: string;
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

    if (!groups.has(clubName)) {
      groups.set(clubName, {
        originalClubName,
        clubName,
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

    const group = groups.get(clubName)!;
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

  // Sort: named clubs alphabetically, "Unassigned" always last
  summaries.sort((a, b) => {
    if (a.clubName === "Unassigned") return 1;
    if (b.clubName === "Unassigned") return -1;
    return a.clubName.localeCompare(b.clubName);
  });

  return summaries;
}
