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

  const isTrackMan = batch.parserMode === "trackman-result";

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
          className="mb-6 underline inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 font-body"
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
      {batch.rows.length > 0 && !isTrackMan && (
        <ImportReviewActions
          batchId={batchId}
          rows={rows}
          columns={columns}
          isTruncated={isTruncated}
          displayLimit={DISPLAY_LIMIT}
          totalRowCount={batch.rowCount}
        />
      )}

      {/* ── TrackMan info banner ─────────────────────────────────────────────── */}
      {isTrackMan && batch.rows.length > 0 && (
        <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-800 font-body">
          <p className="font-semibold mb-1">TrackMan export detected</p>
          <p>
            Shot rows are grouped by club for review. Individual row
            approve&thinsp;/&thinsp;reject is not used for TrackMan imports.
          </p>
        </div>
      )}

      {/* ── Next-step CTA ───────────────────────────────────────────────────── */}
      {isTrackMan && batch.rows.length > 0 && batch.status !== "failed" && (
        <TrackManNextStepPanel batchId={batchId} rowCount={batch.rowCount} />
      )}
      {!isTrackMan && batch.rows.length > 0 && batch.status !== "failed" && (
        <NextStepPanel
          batchId={batchId}
          pendingCount={pendingCount}
          approvedCount={approvedCount}
          rejectedCount={rejectedCount}
        />
      )}
    </>
  );
}

function NextStepPanel({
  batchId,
  pendingCount,
  approvedCount,
  rejectedCount,
}: {
  batchId: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
}) {
  const hasPending = pendingCount > 0;
  const hasApproved = approvedCount > 0;
  const allRejected = approvedCount === 0 && rejectedCount > 0 && !hasPending;

  return (
    <div className="mt-8 rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-xs">
      <h2 className="mb-1 text-sm font-bold text-slate-800 font-heading">
        Next step
      </h2>

      {/* Pending rows remain — staff must finish reviewing */}
      {hasPending && (
        <p className="text-sm text-slate-500 font-body">
          <span className="font-semibold text-yellow-700">
            {pendingCount} row{pendingCount !== 1 ? "s" : ""} still pending.
          </span>{" "}
          Review all rows before continuing to mapping.
        </p>
      )}

      {/* All rows rejected — nothing to map */}
      {allRejected && (
        <div>
          <p className="text-sm text-slate-500 font-body">
            All rows have been rejected. There is nothing to import.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href={`/staff/imports/${batchId}`}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors font-body"
            >
              Reset rows and review again
            </Link>
            <Link
              href="/staff/imports/new"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors font-body"
            >
              Upload a new file
            </Link>
          </div>
        </div>
      )}

      {/* Ready to map — some approved rows exist and no pending */}
      {!hasPending && hasApproved && (
        <div>
          <p className="text-sm text-slate-500 font-body">
            {approvedCount} row{approvedCount !== 1 ? "s" : ""} approved
            {rejectedCount > 0
              ? `, ${rejectedCount} rejected and excluded`
              : ""}
            .
          </p>
          <div className="mt-4">
            <Link
              href={`/staff/imports/${batchId}/map`}
              className="inline-block rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 transition-colors font-body"
            >
              {rejectedCount > 0
                ? "Continue with approved rows only →"
                : "Continue to mapping →"}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function TrackManNextStepPanel({
  batchId,
  rowCount,
}: {
  batchId: number;
  rowCount: number;
}) {
  return (
    <div className="mt-8 rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-xs">
      <h2 className="mb-1 text-sm font-bold text-slate-800 font-heading">
        Club averages ready
      </h2>
      <p className="text-sm text-slate-500 font-body">
        {rowCount} shot{rowCount !== 1 ? "s" : ""} parsed. Club summaries were
        generated automatically during upload.
      </p>
      <div className="mt-4">
        <Link
          href={`/staff/imports/${batchId}/map`}
          className="inline-block rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 transition-colors font-body"
        >
          View club averages →
        </Link>
      </div>
    </div>
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
