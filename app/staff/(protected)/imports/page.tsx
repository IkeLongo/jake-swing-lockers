import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import DeleteBatchButton from "./_components/DeleteBatchButton";
import OpportunityDrawerWrapper from "./_components/OpportunityDrawerWrapper";

export const metadata: Metadata = {
  title: "Fitting History — Jake Swing Lockers Staff",
  robots: { index: false, follow: false },
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
      accessInviteStatus: true,
      ghlOpportunityId: true,
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

  // Separate finalized and unfinalized sessions
  const finalizedSessions = sessions.filter((s) => s.status === "finalized");
  const unfinalizedSessions = sessions.filter((s) => s.status !== "finalized");

  // Fetch unfinalized import batches (pending uploads/reviews)
  // Note: pendingBatches filtered separately for future use; currently shows all via orphanBatches
  await db.importBatch.findMany({
    where: {
      demoSessionId: null,
      status: { in: ["uploaded", "parsed", "reviewing"] },
    },
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
            className="mb-6 underline inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground font-body transition-colors"
          >
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-foreground font-heading">
            Fitting History
          </h1>
          <p className="mt-1 text-sm text-muted-foreground font-body">
            View and manage customer fitting sessions, organized by sales opportunity.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/staff/imports/debug-parser"
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-xs hover:bg-muted transition-colors font-body"
          >
            Debug parser
          </Link>
          <Link
            href="/staff/demo-sessions/new"
            className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold shadow-xs hover:bg-primary-hover transition-colors font-body"
          >
            Upload Demo Session
          </Link>
        </div>
      </div>

      {/* ── Empty state ─────────────────────────────────────────────────────── */}
      {!hasAny && (
        <div className="rounded-xl border border-dashed border-border bg-card px-8 py-16 text-center">
          <div className="mb-3 text-4xl">👤</div>
          <h2 className="text-base font-semibold text-foreground font-subheading">
            No demo sessions yet
          </h2>
          <p className="mt-1 text-sm text-muted-foreground font-body">
            Create a session for a golfer to get started.
          </p>
          <Link
            href="/staff/demo-sessions/new"
            className="mt-6 inline-block rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold hover:bg-primary-hover transition-colors font-body"
          >
            Create first session
          </Link>
        </div>
      )}

      {/* ── Finalized sessions (grouped by opportunity) ────────────────────── */}
      {finalizedSessions.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground font-subheading uppercase tracking-wide">
            Fittings by Opportunity
          </h2>
          <OpportunityDrawerWrapper sessions={finalizedSessions} />
        </div>
      )}

      {/* ── Pending imports (unfinalized sessions) ──────────────────────────── */}
      {unfinalizedSessions.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground font-subheading uppercase tracking-wide">
            Pending Imports
          </h2>
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
            <table className="min-w-full text-sm font-body">
              <thead className="border-b border-border bg-muted">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                    Golfer
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                    Demo Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                    Clubs
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                    Access
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {unfinalizedSessions.map((s) => {
                  const clientName =
                    [s.client.firstName, s.client.lastName]
                      .filter(Boolean)
                      .join(" ") || s.client.email || "Unknown Client";
                  const latestBatch = s.importBatches[0] ?? null;
                  const clubCount = latestBatch?.clubSummaries.length ?? 0;
                  const demoDateStr = new Date(s.demoDate).toLocaleDateString(
                    "en-US",
                    { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" },
                  );

                  const getStatusBadgeClass = (status: string): string => {
                    switch (status) {
                      case "draft":
                        return "bg-muted text-muted-foreground";
                      case "uploaded":
                        return "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200";
                      case "reviewing":
                        return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-200";
                      case "finalized":
                        return "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200";
                      case "failed":
                        return "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200";
                      default:
                        return "bg-muted text-muted-foreground";
                    }
                  };

                  const actionHref = latestBatch
                    ? `/staff/imports/${latestBatch.id}/map`
                    : `/staff/demo-sessions/${s.id}/upload`;
                  const actionLabel = latestBatch ? "Review →" : "Upload file →";

                  return (
                    <tr key={s.id} className="border-t border-border hover:bg-card/50 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-medium text-foreground">
                          {clientName}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        {demoDateStr}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${getStatusBadgeClass(s.status)}`}
                        >
                          {s.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                        {clubCount > 0 ? clubCount : <span className="text-muted-foreground/50">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-muted-foreground/50">—</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-5">
                          <Link
                            href={actionHref}
                            className="text-sm font-medium text-primary hover:text-primary-hover hover:underline whitespace-nowrap transition-colors"
                          >
                            {actionLabel}
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Orphan batches (uploaded before session workflow) ─────────────── */}
      {orphanBatches.length > 0 && (
        <>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground font-subheading uppercase tracking-wide">
            Legacy uploads (no session)
          </h2>
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
            <table className="min-w-full text-sm font-body">
              <thead className="border-b border-border bg-muted">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    File
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Rows
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Uploaded
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {orphanBatches.map((batch) => {
                  const statusStyle =
                    BATCH_STATUS_STYLES[batch.status] ??
                    "bg-muted text-muted-foreground";
                  return (
                    <tr key={batch.id} className="border-t border-border hover:bg-card/50 transition-colors">
                      <td className="max-w-xs truncate px-4 py-3 font-medium text-foreground">
                        {batch.originalFileName}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${statusStyle}`}
                        >
                          {batch.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                        {batch.rowCount}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
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
                            className="text-sm font-medium text-primary hover:text-primary-hover hover:underline transition-colors"
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



