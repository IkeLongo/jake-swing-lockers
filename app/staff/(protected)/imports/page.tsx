import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import DeleteSessionButton from "./_components/DeleteSessionButton";
import DeleteBatchButton from "./_components/DeleteBatchButton";

export const metadata: Metadata = {
  title: "Demo Sessions — Jake Swing Lockers Staff",
  robots: { index: false, follow: false },
};

const SESSION_STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-500",
  uploaded: "bg-blue-100 text-blue-700",
  reviewing: "bg-yellow-100 text-yellow-700",
  finalized: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
};

const BATCH_STATUS_STYLES: Record<string, string> = {
  uploaded: "bg-slate-100 text-slate-600",
  parsed: "bg-blue-100 text-blue-700",
  reviewing: "bg-yellow-100 text-yellow-700",
  approved: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
};

export default async function StaffImportsPage() {
  // Fetch DemoSessions with linked client + import batch summary
  const sessions = await db.demoSession.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      status: true,
      demoDate: true,
      createdAt: true,
      client: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
        },
      },
      importBatches: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          rowCount: true,
          clubSummaries: {
            select: { id: true },
          },
        },
      },
    },
  });

  // Also fetch orphan batches (no demoSession) for backward compat
  const orphanBatches = await db.importBatch.findMany({
    where: { demoSessionId: null },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      originalFileName: true,
      status: true,
      rowCount: true,
      createdAt: true,
    },
  });

  const hasAny = sessions.length > 0 || orphanBatches.length > 0;

  return (
    <>
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <Link
            href="/staff/dashboard"
            className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 font-body"
          >
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-heading">
            Demo Sessions
          </h1>
          <p className="mt-1 text-sm text-slate-500 font-body">
            Create a demo session, upload a TrackMan file, and review club
            averages before finalizing.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/staff/imports/debug-parser"
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-xs hover:bg-slate-50 transition-colors font-body"
          >
            Debug parser
          </Link>
          <Link
            href="/staff/demo-sessions/new"
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 transition-colors font-body"
          >
            Upload Demo Session
          </Link>
        </div>
      </div>

      {/* ── Empty state ─────────────────────────────────────────────────────── */}
      {!hasAny && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-8 py-16 text-center">
          <div className="mb-3 text-4xl">👤</div>
          <h2 className="text-base font-semibold text-slate-700 font-subheading">
            No demo sessions yet
          </h2>
          <p className="mt-1 text-sm text-slate-400 font-body">
            Create a session for a golfer to get started.
          </p>
          <Link
            href="/staff/demo-sessions/new"
            className="mt-6 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors font-body"
          >
            Create first session
          </Link>
        </div>
      )}

      {/* ── Demo sessions table ──────────────────────────────────────────────── */}
      {sessions.length > 0 && (
        <div className="mb-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
          <table className="min-w-full text-sm font-body">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                  Golfer
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                  Demo Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                  Status
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                  Clubs
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                  Uploaded
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sessions.map((s) => {
                const clientName =
                  [s.client.firstName, s.client.lastName]
                    .filter(Boolean)
                    .join(" ") || s.client.email || "Unknown Client";
                const latestBatch = s.importBatches[0] ?? null;
                const clubCount = latestBatch?.clubSummaries.length ?? 0;
                const statusStyle =
                  SESSION_STATUS_STYLES[s.status] ??
                  "bg-slate-100 text-slate-500";
                const demoDateStr = new Date(s.demoDate).toLocaleDateString(
                  "en-US",
                  { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" },
                );
                const uploadedStr = new Date(s.createdAt).toLocaleDateString(
                  "en-US",
                  { month: "short", day: "numeric", year: "numeric" },
                );

                // Determine the best action link
                const actionHref = latestBatch
                  ? `/staff/imports/${latestBatch.id}/map`
                  : `/staff/demo-sessions/${s.id}/upload`;
                const actionLabel = latestBatch ? "Review →" : "Upload file →";

                return (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-800">
                        {clientName}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                      {demoDateStr}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${statusStyle}`}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600 tabular-nums">
                      {clubCount > 0 ? clubCount : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                      {uploadedStr}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-5">
                        <Link
                          href={actionHref}
                          className="text-sm font-medium text-emerald-700 hover:text-emerald-800 hover:underline whitespace-nowrap"
                        >
                          {actionLabel}
                        </Link>
                        <DeleteSessionButton
                          sessionId={s.id}
                          clientName={clientName}
                          demoDate={demoDateStr}
                          status={s.status}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Orphan batches (uploaded before session workflow) ─────────────── */}
      {orphanBatches.length > 0 && (
        <>
          <h2 className="mb-3 text-sm font-semibold text-slate-500 font-subheading uppercase tracking-wide">
            Legacy uploads (no session)
          </h2>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
            <table className="min-w-full text-sm font-body">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    File
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Rows
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Uploaded
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orphanBatches.map((batch) => {
                  const statusStyle =
                    BATCH_STATUS_STYLES[batch.status] ??
                    "bg-slate-100 text-slate-600";
                  return (
                    <tr key={batch.id} className="hover:bg-slate-50">
                      <td className="max-w-xs truncate px-4 py-3 font-medium text-slate-800">
                        {batch.originalFileName}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${statusStyle}`}
                        >
                          {batch.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600 tabular-nums">
                        {batch.rowCount}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                        {new Date(batch.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-5">
                          <Link
                            href={`/staff/imports/${batch.id}/map`}
                            className="text-sm font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
                          >
                            Review →
                          </Link>
                          <DeleteBatchButton
                            batchId={batch.id}
                            fileName={batch.originalFileName}
                            uploadedDate={new Date(batch.createdAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}



