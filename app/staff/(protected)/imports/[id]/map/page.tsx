import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ClubSummarySection } from "./_components/ClubSummarySection";
import type { SerializedClubSummary } from "./_components/EditClubSummaryModal";
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
  const batchId = parseInt(id, 10);
  if (isNaN(batchId)) notFound();

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
        trackmanSessionId: true,
        trackmanPlayerId: true,
        trackmanPlayerName: true,
        trackmanPlayerEmail: true,
        trackmanSessionDate: true,
        trackmanMetadataError: true,
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
    linkedToSummaryId: s.linkedToSummaryId ?? null,
  }));

  return (
    <>
      {/* ── Back nav ───────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <Link
          href="/staff/imports"
          className="mb-6 underline inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 font-body"
        >
          ← Back to Sessions
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

        {!batch.demoSession && batch.parserMode === "trackman-result" && (
          <TrackManSessionCard
            playerName={batch.trackmanPlayerName}
            playerEmail={batch.trackmanPlayerEmail}
            sessionDate={batch.trackmanSessionDate}
            sessionId={batch.trackmanSessionId}
            playerId={batch.trackmanPlayerId}
            metadataError={batch.trackmanMetadataError}
          />
        )}

        <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-heading">
          Club Averages
        </h1>
        <p className="mt-1 text-sm text-slate-500 font-body">
          {batch.originalFileName}
        </p>
      </div>

      {/* ── Batch summary cards ──────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap gap-3">
        <StatCard label="Total Shots" value={batch.rowCount.toLocaleString()} />
        <StatusCard status={batch.status} />
        <StatCard
          label="Clubs Found"
          value={summaries.length.toString()}
          accent="blue"
        />
      </div>

      {/* ── Swing Locker Access ──────────────────────────────────────────── */}
      {batch.demoSession && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400 font-subheading">
            Swing Locker Access
          </h2>
          {batch.demoSession.status !== "finalized" ? (
            <p className="text-sm text-slate-400">
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
              <div className="border-t border-slate-100 pt-3">
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
      />

    </>
  );
}

function TrackManSessionCard({
  playerName,
  playerEmail,
  sessionDate,
  sessionId,
  playerId,
  metadataError,
}: {
  playerName: string | null;
  playerEmail: string | null;
  sessionDate: Date | null;
  sessionId: string | null;
  playerId: string | null;
  metadataError: string | null;
}) {
  const hasIdentity = playerName || playerEmail || sessionDate || sessionId || playerId;

  return (
    <div className="mb-4 space-y-3">
      <section className="rounded-xl border border-border bg-card px-5 py-4 shadow-xs">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground font-subheading">
          TrackMan Session
        </p>
        {hasIdentity ? (
          <div className="mt-2 space-y-1 text-sm font-body">
            {playerName && <p className="font-semibold text-foreground">{playerName}</p>}
            {playerEmail && <p className="text-muted-foreground">{playerEmail}</p>}
            {sessionDate && (
              <p className="pt-1 text-muted-foreground">
                Session date: {sessionDate.toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                  timeZone: "UTC",
                })}
              </p>
            )}
            {(sessionId || playerId) && (
              <p className="pt-1 text-xs text-muted-foreground">
                {sessionId && `TrackMan session: ${sessionId}`}
                {sessionId && playerId && " · "}
                {playerId && `Player: ${playerId}`}
              </p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground font-body">
            This staged import has no TrackMan session details.
          </p>
        )}
        <p className="mt-3 text-xs text-muted-foreground font-body">
          Staged import — not yet assigned to a customer or sales opportunity.
        </p>
      </section>

      {metadataError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 font-body">
          TrackMan session metadata could not be resolved consistently: {metadataError}
        </div>
      )}
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  accent = "slate",
}: {
  label: string;
  value: string;
  accent?: "slate" | "emerald" | "red" | "yellow" | "blue";
}) {
  const accentClass = {
    slate: "text-slate-700",
    emerald: "text-emerald-700",
    red: "text-red-600",
    yellow: "text-yellow-700",
    blue: "text-blue-700",
  }[accent];

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xs min-w-[110px]">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 font-subheading">
        {label}
      </p>
      <p className={`mt-1 text-lg font-bold font-heading ${accentClass}`}>
        {value}
      </p>
    </div>
  );
}

// ── Status card ───────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<
  string,
  { bg: string; border: string; text: string; label: string }
> = {
  parsed: {
    bg: "bg-blue-50",
    border: "border-blue-200",
    text: "text-blue-700",
    label: "Parsed",
  },
  reviewing: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-700",
    label: "Reviewing",
  },
  approved: {
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    text: "text-emerald-700",
    label: "Approved",
  },
  failed: {
    bg: "bg-red-50",
    border: "border-red-200",
    text: "text-red-700",
    label: "Failed",
  },
  uploaded: {
    bg: "bg-slate-50",
    border: "border-slate-200",
    text: "text-slate-600",
    label: "Uploaded",
  },
};

function StatusCard({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? {
    bg: "bg-slate-50",
    border: "border-slate-200",
    text: "text-slate-600",
    label: status,
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xs min-w-[110px]">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 font-subheading">
        Status
      </p>
      <div className="mt-1">
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold font-subheading ${style.bg} ${style.border} ${style.text}`}
        >
          {style.label}
        </span>
      </div>
    </div>
  );
}
