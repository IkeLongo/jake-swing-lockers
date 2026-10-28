import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { IconArrowLeft } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { getReviewPageRedirect } from "@/lib/imports/customer-workflow-routing";
import { ClubSummarySection } from "./_components/ClubSummarySection";
import type { SerializedClubSummary } from "./_components/clubSummaryTypes";
import SessionDetailsCard from "./_components/SessionDetailsCard";
import SendAccessButton from "../../_components/SendAccessButton";
import PreviewLockerButton from "../../_components/PreviewLockerButton";

export const metadata: Metadata = {
  title: "Club Averages — Jake Swing Lockers Staff",
  robots: { index: false, follow: false },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  // Prisma Decimal has a toNumber() method
  if (typeof v === "object" && "toNumber" in (v as object)) {
    return (v as { toNumber(): number }).toNumber();
  }
  const n = parseFloat(String(v));
  return isFinite(n) ? n : null;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ImportMapPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) notFound();
  const batchId = Number(id);
  if (!Number.isSafeInteger(batchId)) notFound();

  const [batch, summariesRaw] = await Promise.all([
    db.importBatch.findUnique({
      where: { id: batchId },
      select: {
        id: true,
        originalFileName: true,
        status: true,
        rowCount: true,
        parserMode: true,
        demoSessionId: true,
        customerResolution: true,
        selectedGolfClientId: true,
        proposedFirstName: true,
        proposedLastName: true,
        proposedEmail: true,
        proposedPhone: true,
        trackmanPlayerName: true,
        trackmanPlayerEmail: true,
        createdAt: true,
        demoSession: {
          select: {
            id: true,
            demoDate: true,
            status: true,
            needsRefinalization: true,
            notes: true,
            accessInviteStatus: true,
            client: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
              },
            },
          },
        },
      },
    }),
    db.importClubSummary.findMany({
      where: { importBatchId: batchId },
      orderBy: [{ clubName: "asc" }],
    }),
  ]);

  if (!batch) notFound();
  const redirectToCustomer = getReviewPageRedirect(batch);
  if (redirectToCustomer) redirect(redirectToCustomer);

  // Serialize Decimal fields for client components
  const summaries: SerializedClubSummary[] = summariesRaw.map((s) => ({
    id: s.id,
    importBatchId: s.importBatchId,
    originalClubName: s.originalClubName,
    clubName: s.clubName,
    tags: Array.isArray(s.tags) ? (s.tags as string[]) : [],
    shotCount: s.shotCount,
    avgClubSpeed: toNum(s.avgClubSpeed),
    avgBallSpeed: toNum(s.avgBallSpeed),
    avgSpinRate: toNum(s.avgSpinRate),
    avgMaxHeight: toNum(s.avgMaxHeight),
    avgCarry: toNum(s.avgCarry),
    avgTotal: toNum(s.avgTotal),
    validClubSpeedCount: s.validClubSpeedCount,
    validBallSpeedCount: s.validBallSpeedCount,
    validSpinRateCount: s.validSpinRateCount,
    validMaxHeightCount: s.validMaxHeightCount,
    validCarryCount: s.validCarryCount,
    validTotalCount: s.validTotalCount,
    isManuallyEdited: s.isManuallyEdited,
    includeInReport: s.includeInReport,
    estimatedPrice: toNum(s.estimatedPrice),
    currentSummaryId: s.currentSummaryId ?? null,
  }));

  const backHref = "/staff/imports";
  const backLabel = batch.demoSession ? "Back to Sessions" : "Back to Imports";
  const isTrackManReview =
    !batch.demoSession && batch.parserMode === "trackman-result";

  return (
    <div>
      {/* ── Back nav ───────────────────────────────────────────────────────── */}
      <div className={`${isTrackManReview ? "mb-6 max-w-4xl" : "mb-6 max-w-3xl"}`}>
        <Link
          href={backHref}
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground font-body transition-colors"
        >
          <IconArrowLeft className="h-4 w-4" />
          {backLabel}
        </Link>

        {/* Golfer context card (shown when linked to a DemoSession) */}
        {batch.demoSession && (
          <SessionDetailsCard
            sessionId={batch.demoSession.id}
            sessionStatus={batch.demoSession.status}
            uploadedAt={batch.createdAt.toISOString()}
            initial={{
              firstName: batch.demoSession.client.firstName ?? "",
              lastName: batch.demoSession.client.lastName ?? "",
              email: batch.demoSession.client.email ?? "",
              phone: batch.demoSession.client.phone ?? "",
              demoDate: batch.demoSession.demoDate.toISOString(),
              notes: batch.demoSession.notes ?? "",
            }}
          />
        )}

        {isTrackManReview ? (
          <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="text-lg font-bold text-foreground font-heading">
                Review Fitting
              </h1>
              <StatusBadge status={batch.status} />
            </div>
            {(batch.trackmanPlayerName || batch.trackmanPlayerEmail) && (
              <div className="mt-2">
                {batch.trackmanPlayerName && (
                  <p className="text-base font-semibold text-foreground font-subheading">
                    {batch.trackmanPlayerName}
                  </p>
                )}
                {batch.trackmanPlayerEmail && (
                  <p className="text-sm text-muted-foreground font-body">
                    {batch.trackmanPlayerEmail}
                  </p>
                )}
              </div>
            )}
            <p className="mt-2 text-sm text-muted-foreground font-body">
              Fitting analysis for the recorded clubs and shots.
            </p>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold tracking-tight text-foreground font-heading">
              Club Averages
            </h1>
            <p className="mt-1 text-sm text-muted-foreground font-body">
              {batch.originalFileName}
            </p>
          </>
        )}
      </div>

      {/* ── Batch summary cards ──────────────────────────────────────────────── */}
      {!isTrackManReview && (
        <div className="mb-6 flex flex-wrap gap-3">
          <StatCard label="Total Shots" value={batch.rowCount.toLocaleString()} />
          <StatusCard status={batch.status} />
          <StatCard label="Clubs Found" value={summaries.length.toString()} />
        </div>
      )}

      {/* ── Swing Locker Access ──────────────────────────────────────────── */}
      {batch.demoSession && (
        <div className="mb-6 rounded-xl border border-border bg-card p-4 shadow-xs">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground font-subheading">
            Swing Locker Access
          </h2>
          {batch.demoSession.status !== "finalized" ? (
            <p className="text-sm text-muted-foreground font-body">
              Finalize this session before sending Swing Locker access.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <SendAccessButton
                sessionId={batch.demoSession.id}
                initialStatus={batch.demoSession.accessInviteStatus ?? null}
                clientHasContact={
                  !!(batch.demoSession.client.email || batch.demoSession.client.phone)
                }
                variant="card"
              />
              <div className="border-t border-border pt-3">
                <PreviewLockerButton
                  sessionId={batch.demoSession.id}
                  returnHref={`/staff/imports/${batchId}/map`}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Club summaries (primary) ────────────────────────────────────────── */}
      <ClubSummarySection
        batchId={batchId}
        initialSummaries={summaries}
        parserMode={batch.parserMode}
        sessionId={batch.demoSession?.id}
        sessionStatus={batch.demoSession?.status}
        needsRefinalization={batch.demoSession?.needsRefinalization ?? false}
        hideHeading={isTrackManReview}
      />
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-xs min-w-[110px]">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground font-subheading">
        {label}
      </p>
      <p className="mt-1 text-lg font-bold text-foreground font-heading">{value}</p>
    </div>
  );
}

// ── Status card ───────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { className: string; label: string }> = {
  parsed: {
    className: "border-primary/30 bg-primary/10 text-primary",
    label: "Parsed",
  },
  reviewing: {
    className: "border-accent/40 bg-accent/10 text-accent",
    label: "Reviewing",
  },
  approved: {
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400",
    label: "Approved",
  },
  failed: {
    className:
      "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400",
    label: "Failed",
  },
  uploaded: {
    className: "border-border bg-muted text-muted-foreground",
    label: "Uploaded",
  },
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? {
    className: "border-border bg-muted text-muted-foreground",
    label: status,
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold font-subheading ${style.className}`}
    >
      {style.label}
    </span>
  );
}

function StatusCard({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? {
    className: "border-border bg-muted text-muted-foreground",
    label: status,
  };

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-xs min-w-[110px]">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground font-subheading">
        Status
      </p>
      <div className="mt-1">
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold font-subheading ${style.className}`}
        >
          {style.label}
        </span>
      </div>
    </div>
  );
}
