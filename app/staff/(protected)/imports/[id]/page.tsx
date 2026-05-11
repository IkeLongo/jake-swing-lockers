import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import {
  ImportReviewActions,
  type ImportRow,
} from "./_components/ImportReviewActions";

export const metadata: Metadata = {
  title: "Review Import — Jake Swing Lockers Staff",
  robots: { index: false, follow: false },
};

// Show at most this many rows in the table — keeps the page fast
const DISPLAY_LIMIT = 200;

const BATCH_STATUS_STYLES: Record<string, string> = {
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

  const [batch, rowStatusCounts] = await Promise.all([
    db.importBatch.findUnique({
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
            validationErrors: true,
          },
        },
      },
    }),
    db.importRow.groupBy({
      by: ["status"],
      where: { importBatchId: batchId },
      _count: { status: true },
    }),
  ]);

  if (!batch) notFound();

  // Status counts across ALL rows (not just the displayed slice)
  const pendingCount =
    rowStatusCounts.find((c) => c.status === "pending")?._count.status ?? 0;
  const approvedCount =
    rowStatusCounts.find((c) => c.status === "approved")?._count.status ?? 0;
  const rejectedCount =
    rowStatusCounts.find((c) => c.status === "rejected")?._count.status ?? 0;
  // Error count from displayed rows only (accurate for batches ≤ DISPLAY_LIMIT)
  const errorCount = batch.rows.filter(
    (r) => r.validationErrors !== null && r.validationErrors !== undefined,
  ).length;

  // Derive column list from the first row's keys so the table is dynamic
  const firstRow = batch.rows[0]?.rawData;
  const columns: string[] =
    firstRow != null && typeof firstRow === "object" && !Array.isArray(firstRow)
      ? Object.keys(firstRow as Record<string, unknown>)
      : [];

  const isTruncated = batch.rowCount > DISPLAY_LIMIT;
  const batchStatusStyle =
    BATCH_STATUS_STYLES[batch.status] ?? "bg-slate-100 text-slate-600";

  // Cast Prisma JSON types to the plain interface the client component expects
  const rows: ImportRow[] = batch.rows.map((row) => ({
    id: row.id,
    rowIndex: row.rowIndex,
    rawData: row.rawData as Record<string, unknown>,
    status: row.status,
    validationErrors: row.validationErrors,
  }));

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
          <div className="min-w-0 flex-1">
            <h1
              className="truncate text-2xl font-bold tracking-tight text-slate-900 font-heading"
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
            className={`shrink-0 self-start rounded-full px-3 py-1 text-xs font-semibold font-body uppercase tracking-wide ${batchStatusStyle}`}
          >
            {batch.status}
          </span>
        </div>
      </div>

      {/* ── Summary stats ───────────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap gap-3">
        <Stat label="Total rows" value={batch.rowCount.toString()} />
        <Stat label="Pending" value={pendingCount.toString()} accent="slate" />
        <Stat
          label="Approved"
          value={approvedCount.toString()}
          accent="emerald"
        />
        <Stat
          label="Rejected"
          value={rejectedCount.toString()}
          accent="red"
        />
        {errorCount > 0 && (
          <Stat
            label={isTruncated ? "Errors (first 200)" : "Errors"}
            value={errorCount.toString()}
            accent="red"
          />
        )}
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

      {/* ── Review actions (bulk + per-row) ─────────────────────────────────── */}
      {batch.rows.length > 0 && (
        <ImportReviewActions
          batchId={batchId}
          rows={rows}
          columns={columns}
          isTruncated={isTruncated}
          displayLimit={DISPLAY_LIMIT}
          totalRowCount={batch.rowCount}
        />
      )}
    </>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "slate" | "emerald" | "red";
}) {
  const valueColor =
    accent === "emerald"
      ? "text-emerald-700"
      : accent === "red"
        ? "text-red-600"
        : "text-slate-900";

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-xs">
      <p className="text-xs font-medium text-slate-500 font-body">{label}</p>
      <p
        className={`mt-0.5 text-lg font-bold font-heading tabular-nums ${valueColor}`}
      >
        {value}
      </p>
    </div>
  );
}
