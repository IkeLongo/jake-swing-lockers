import type { Prisma } from "@/app/generated/prisma/client";

// Placeholder target model labels shown in the mapping preview table.
// When the real TrackMan export format is known, these will become explicit
// column → field mappings wired through a normalizeTrackManRow() function.
const FUTURE_TARGET_AREAS = [
  "GolfClient",
  "DemoSession",
  "DemoClubTest",
  "ClubTestMetrics",
];

interface Props {
  /** Approved ImportRows (rawData already cast). */
  rows: Array<{ rawData: Prisma.JsonValue }>;
}

export function ImportMappingPreview({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-slate-400 font-body">
        No approved rows to preview.
      </p>
    );
  }

  const firstRow = rows[0].rawData;
  const columns: string[] =
    firstRow !== null &&
    typeof firstRow === "object" &&
    !Array.isArray(firstRow)
      ? Object.keys(firstRow as Record<string, unknown>)
      : [];

  const sampleValues =
    firstRow !== null &&
    typeof firstRow === "object" &&
    !Array.isArray(firstRow)
      ? (firstRow as Record<string, unknown>)
      : {};

  if (columns.length === 0) {
    return (
      <p className="text-sm text-slate-400 font-body">
        No columns detected in approved rows.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
      <table className="min-w-full text-sm font-body">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
              Raw Column
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
              Sample Value
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
              Future Target Model
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {columns.map((col, i) => (
            <tr key={col} className="hover:bg-slate-50">
              <td className="px-4 py-2.5 font-medium text-slate-800 whitespace-nowrap">
                {col}
              </td>
              <td
                className="max-w-xs truncate px-4 py-2.5 text-slate-600 whitespace-nowrap"
                title={String(sampleValues[col] ?? "")}
              >
                {String(sampleValues[col] ?? "")}
              </td>
              <td className="px-4 py-2.5 text-slate-400 italic whitespace-nowrap">
                {/* Cycle through model names as a visual placeholder */}
                {FUTURE_TARGET_AREAS[i % FUTURE_TARGET_AREAS.length]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
