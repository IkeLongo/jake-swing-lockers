import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import type { Prisma } from "@/app/generated/prisma/client";

export const metadata: Metadata = {
  title: "Review Import — Jake Swing Lockers Staff",
  robots: { index: false, follow: false },
};

// Show at most this many rows in the table — keeps the page fast
const DISPLAY_LIMIT = 200;

const STATUS_STYLES: Record<string, string> = {
  uploaded: "bg-slate-100 text-slate-600",
  parsed: "bg-blue-100 text-blue-700",
  reviewing: "bg-yellow-100 text-yellow-700",
  approved: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
};

export default async function ImportBatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const batchId = parseInt(id, 10);
  if (isNaN(batchId)) notFound();

  const batch = await db.importBatch.findUnique({
    where: { id: batchId },
    include: {
      rows: {
        orderBy: { rowIndex: "asc" },
        take: DISPLAY_LIMIT,
        select: {
          id: true,
          rowIndex: true,
          rawData: true,
          status: true,
        },
      },
    },
  });

  if (!batch) notFound();

  // Derive column list from the first row's keys so the table is dynamic
  const firstRow = batch.rows[0]?.rawData;
  const columns: string[] =
    firstRow != null && typeof firstRow === "object" && !Array.isArray(firstRow)
      ? Object.keys(firstRow as Record<string, unknown>)
      : [];

  const isTruncated = batch.rowCount > DISPLAY_LIMIT;
  const statusStyle =
    STATUS_STYLES[batch.status] ?? "bg-slate-100 text-slate-600";

  return (
    <>
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <Link
          href="/staff/imports"
          className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 font-body"
        >
          ← Back to Imports
        </Link>

        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-0">
            <h1
              className="text-2xl font-bold tracking-tight text-slate-900 font-heading truncate"
              title={batch.originalFileName}
            >
              {batch.originalFileName}
            </h1>
            <p className="mt-1 text-sm text-slate-500 font-body">
              Uploaded{" "}
              {new Date(batch.createdAt).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          </div>

          <span
            className={`shrink-0 self-start rounded-full px-3 py-1 text-xs font-semibold font-body uppercase tracking-wide ${statusStyle}`}
          >
            {batch.status}
          </span>
        </div>
      </div>

      {/* ── Stats bar ───────────────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap gap-4">
        <Stat label="Total rows" value={batch.rowCount.toString()} />
        <Stat label="Columns" value={columns.length.toString()} />
        <Stat label="Batch ID" value={`#${batch.id}`} />
      </div>

      {/* ── Failed state ────────────────────────────────────────────────────── */}
      {batch.status === "failed" && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700 font-body">
          This import failed during parsing. Check that the file is a valid CSV
          or XLSX and try uploading again.
        </div>
      )}

      {/* ── No rows ─────────────────────────────────────────────────────────── */}
      {batch.rows.length === 0 && batch.status !== "failed" && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-8 py-12 text-center">
          <p className="text-sm text-slate-400 font-body">
            No rows were parsed from this file.
          </p>
        </div>
      )}

      {/* ── Row table ───────────────────────────────────────────────────────── */}
      {batch.rows.length > 0 && (
        <>
          {isTruncated && (
            <div className="mb-4 rounded-lg bg-yellow-50 px-4 py-3 text-sm text-yellow-800 font-body">
              Showing first {DISPLAY_LIMIT} of {batch.rowCount} rows.
              {/* TODO: add pagination in a future phase */}
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
            <table className="min-w-full text-sm font-body">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 w-12">
                    #
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col}
                      className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {batch.rows.map((row) => {
                  const data = row.rawData as Prisma.JsonObject;
                  return (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-xs text-slate-400 tabular-nums">
                        {row.rowIndex + 1}
                      </td>
                      {columns.map((col) => (
                        <td
                          key={col}
                          className="px-3 py-2 text-slate-700 whitespace-nowrap max-w-xs truncate"
                          title={String(data[col] ?? "")}
                        >
                          {String(data[col] ?? "")}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* TODO: Add review actions here (approve, flag rows, map columns)
               once TrackMan column structure is confirmed and mapping logic
               into DemoSession / DemoClubTest / ClubTestMetrics is defined. */}
          <div className="mt-6 rounded-xl border border-dashed border-slate-200 bg-white px-6 py-5 text-center">
            <p className="text-sm font-semibold text-slate-500 font-subheading">
              Review actions coming soon
            </p>
            <p className="mt-1 text-xs text-slate-400 font-body">
              Column mapping, row approval, and saving to client records will be
              available after TrackMan export format is confirmed.
            </p>
          </div>
        </>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-xs">
      <p className="text-xs font-medium text-slate-500 font-body">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-slate-900 font-heading tabular-nums">
        {value}
      </p>
    </div>
  );
}
