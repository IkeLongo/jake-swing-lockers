import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { calculateFittingValue } from "@/lib/fitting-value";
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

// Determine the next workflow step for an in-progress TrackMan batch
function getInProgressContinueUrl(batch: {
  id: number;
  parserMode: string;
  status: string;
  selectedGolfClientId: number | null;
}): string {
  const base = `/staff/imports/${batch.id}`;
  
  // Non-TrackMan imports go to the generic review page
  if (batch.parserMode !== "trackman-result") {
    return base;
  }
  
  // For TrackMan imports, default to map page (club review/filtering).
  // The page will handle redirects to customer/opportunity if needed.
  return `${base}/map`;
}

export default async function StaffImportsPage() {
  // Fetch DemoSessions with linked client + import batch summary
  const sessionsRaw = await db.demoSession.findMany({
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
            select: { 
              includeInReport: true,
              estimatedPrice: true,
            },
          },
        },
      },
    },
  });

  // Transform raw sessions to include pre-calculated club count and fitting value
  const sessions = sessionsRaw.map((session) => {
    const latestBatch = session.importBatches[0] ?? null;
    const fittingValue = calculateFittingValue(latestBatch?.clubSummaries ?? []);

    return {
      ...session,
      clubCount: fittingValue.includedClubCount,
      fittingValue,
      importBatches: session.importBatches.map((batch) => ({
        ...batch,
        clubSummaries: undefined, // Remove raw club data to avoid serialization
      })),
    };
  });

  // Separate finalized sessions (unfinalized sessions are now in inProgressBatches)
  const finalizedSessions = sessions.filter((s) => s.status === "finalized");

  // Fetch unfinalized import batches (actively in progress)
  // These are batches in active review/approval workflow with no linked DemoSession yet
  const inProgressBatches = await db.importBatch.findMany({
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
      parserMode: true,
      selectedGolfClientId: true,
      selectedGolfClient: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
        },
      },
    },
  });

  // Fetch genuine legacy/abandoned batches (no demoSession)
  // These are batches that reached "approved" but never transitioned to a DemoSession (old workflow),
  // or batches that failed and were abandoned.
  const legacyBatches = await db.importBatch.findMany({
    where: {
      demoSessionId: null,
      status: { in: ["approved", "failed"] },
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

  const hasAny = sessions.length > 0 || inProgressBatches.length > 0 || legacyBatches.length > 0;

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

      {/* ── Fittings in progress (unfinalized imports + pending sessions) ───── */}
      {inProgressBatches.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground font-subheading uppercase tracking-wide">
            Fittings in Progress ({inProgressBatches.length})
          </h2>
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
            <table className="min-w-full text-sm font-body">
              <thead className="border-b border-border bg-muted">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                    Customer / File
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                    Clubs
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                    Uploaded
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {inProgressBatches.map((batch) => {
                  const statusStyle =
                    BATCH_STATUS_STYLES[batch.status] ?? "bg-muted text-muted-foreground";
                  const clientName = batch.selectedGolfClient
                    ? [batch.selectedGolfClient.firstName, batch.selectedGolfClient.lastName]
                        .filter(Boolean)
                        .join(" ") || batch.selectedGolfClient.email || "Unknown Client"
                    : batch.originalFileName || "Unnamed Upload";
                  const uploadedDateStr = new Date(batch.createdAt).toLocaleDateString(
                    "en-US",
                    { month: "short", day: "numeric", year: "numeric" },
                  );
                  const continueUrl = getInProgressContinueUrl(batch);

                  return (
                    <tr key={batch.id} className="border-t border-border hover:bg-card/50 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-medium text-foreground">
                          {clientName}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${statusStyle}`}
                        >
                          {batch.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                        {batch.rowCount > 0 ? batch.rowCount : <span className="text-muted-foreground/50">—</span>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        {uploadedDateStr}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-5">
                          <Link
                            href={continueUrl}
                            className="text-sm font-medium text-primary hover:text-primary-hover hover:underline whitespace-nowrap transition-colors"
                          >
                            Continue →
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
      {/* This section is now covered by "Fittings in Progress" above */}

      {/* ── Legacy uploads (approved or failed batches with no session) ─────── */}
      {legacyBatches.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground font-subheading uppercase tracking-wide">
            Legacy Uploads
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
                {legacyBatches.map((batch) => {
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
        </div>
      )}
    </>
  );
}



