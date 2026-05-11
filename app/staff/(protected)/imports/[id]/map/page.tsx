import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ImportMappingPreview } from "../_components/ImportMappingPreview";

export const metadata: Metadata = {
  title: "Map Import — Jake Swing Lockers Staff",
  robots: { index: false, follow: false },
};

export default async function ImportMapPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const batchId = parseInt(id, 10);
  if (isNaN(batchId)) notFound();

  const [batch, rowStatusCounts, approvedRows] = await Promise.all([
    db.importBatch.findUnique({
      where: { id: batchId },
      select: {
        id: true,
        originalFileName: true,
        status: true,
        rowCount: true,
        createdAt: true,
      },
    }),
    db.importRow.groupBy({
      by: ["status"],
      where: { importBatchId: batchId },
      _count: { status: true },
    }),
    db.importRow.findMany({
      where: { importBatchId: batchId, status: "approved" },
      orderBy: { rowIndex: "asc" },
      select: { rawData: true },
    }),
  ]);

  if (!batch) notFound();

  const approvedCount =
    rowStatusCounts.find((c) => c.status === "approved")?._count.status ?? 0;
  const rejectedCount =
    rowStatusCounts.find((c) => c.status === "rejected")?._count.status ?? 0;
  const pendingCount =
    rowStatusCounts.find((c) => c.status === "pending")?._count.status ?? 0;

  // Derive column list from first approved row
  const firstApprovedRaw = approvedRows[0]?.rawData;
  const columns: string[] =
    firstApprovedRaw !== null &&
    typeof firstApprovedRaw === "object" &&
    !Array.isArray(firstApprovedRaw)
      ? Object.keys(firstApprovedRaw as Record<string, unknown>)
      : [];

  return (
    <>
      {/* ── Back nav ────────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <Link
          href={`/staff/imports/${batchId}`}
          className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 font-body"
        >
          ← Back to Review
        </Link>

        <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-heading">
          Map Import
        </h1>
        <p className="mt-1 text-sm text-slate-500 font-body">
          {batch.originalFileName}
        </p>
      </div>

      {/* ── Batch summary ───────────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap gap-3">
        <StatCard label="Total rows" value={batch.rowCount.toString()} />
        <StatCard
          label="Approved"
          value={approvedCount.toString()}
          accent="emerald"
        />
        <StatCard
          label="Rejected"
          value={rejectedCount.toString()}
          accent="red"
        />
        {pendingCount > 0 && (
          <StatCard
            label="Pending"
            value={pendingCount.toString()}
            accent="yellow"
          />
        )}
        <StatCard label="Columns detected" value={columns.length.toString()} />
      </div>

      {/* ── Pending rows warning ─────────────────────────────────────────────── */}
      {pendingCount > 0 && (
        <div className="mb-6 rounded-xl border border-yellow-200 bg-yellow-50 px-5 py-4 text-sm text-yellow-800 font-body">
          <span className="font-semibold">
            {pendingCount} row{pendingCount !== 1 ? "s" : ""} are still pending.
          </span>{" "}
          Only approved rows are included below.{" "}
          <Link
            href={`/staff/imports/${batchId}`}
            className="underline hover:text-yellow-900"
          >
            Go back to review the remaining rows.
          </Link>
        </div>
      )}

      {/* ── No approved rows ────────────────────────────────────────────────── */}
      {approvedCount === 0 && (
        <div className="mb-6 rounded-xl border border-dashed border-slate-300 bg-white px-8 py-12 text-center">
          <p className="text-sm font-semibold text-slate-500 font-subheading">
            No approved rows
          </p>
          <p className="mt-1 text-xs text-slate-400 font-body">
            Approve at least one row on the review page before mapping.
          </p>
          <Link
            href={`/staff/imports/${batchId}`}
            className="mt-4 inline-block text-sm font-medium text-emerald-700 hover:underline font-body"
          >
            ← Back to review
          </Link>
        </div>
      )}

      {/* ── Column preview ──────────────────────────────────────────────────── */}
      {approvedCount > 0 && (
        <>
          <div className="mb-4">
            <h2 className="text-base font-bold text-slate-800 font-heading">
              Detected columns
            </h2>
            <p className="mt-0.5 text-sm text-slate-500 font-body">
              Columns from the first approved row. Sample values are shown for
              reference.
            </p>
          </div>

          <ImportMappingPreview rows={approvedRows} />
        </>
      )}

      {/* ── Target model placeholders ───────────────────────────────────────── */}
      {approvedCount > 0 && (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {(
            [
              {
                model: "GolfClient",
                desc: "The client receiving the demo session. Matched by name or email.",
              },
              {
                model: "DemoSession",
                desc: "The top-level demo event. Links date, rep, and client.",
              },
              {
                model: "DemoClubTest",
                desc: "One test entry per club tested during the session.",
              },
              {
                model: "ClubTestMetrics",
                desc: "Numeric performance data attached to each club test.",
              },
            ] as const
          ).map(({ model, desc }) => (
            <div
              key={model}
              className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-xs"
            >
              <h3 className="text-sm font-bold text-slate-800 font-heading">
                {model}
              </h3>
              <p className="mt-1 text-xs text-slate-500 font-body">{desc}</p>
              <p className="mt-3 text-xs italic text-slate-400 font-body">
                Column mapping will be configured once the TrackMan export
                format is confirmed.
              </p>
            </div>
          ))}
        </div>
      )}

      {/* ── TrackMan notice ─────────────────────────────────────────────────── */}
      <div className="mt-8 rounded-xl border border-blue-100 bg-blue-50 px-5 py-4 text-sm text-blue-800 font-body">
        <p className="font-semibold font-heading mb-1">
          TrackMan column mapping pending
        </p>
        <p>
          Final import into client records is intentionally not available yet.
          TrackMan column mapping will be completed after we receive the real
          export sample. At that point the following will be implemented:
        </p>
        <ul className="mt-2 list-disc pl-5 space-y-0.5 text-xs">
          <li>
            <code>normalizeTrackManRow()</code> — maps raw column names to typed
            fields
          </li>
          <li>Mapping profile support for different TrackMan export formats</li>
          <li>Final import confirmation step</li>
          <li>Create or match existing GolfClient by name / email</li>
          <li>Create DemoSession linked to the client</li>
          <li>Create DemoClubTest rows per club</li>
          <li>Create ClubTestMetrics per club test</li>
          <li>GHL follow-up sync trigger</li>
          <li>Swing Locker link generation</li>
        </ul>
      </div>
    </>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "emerald" | "red" | "yellow";
}) {
  const valueColor =
    accent === "emerald"
      ? "text-emerald-700"
      : accent === "red"
        ? "text-red-600"
        : accent === "yellow"
          ? "text-yellow-700"
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
