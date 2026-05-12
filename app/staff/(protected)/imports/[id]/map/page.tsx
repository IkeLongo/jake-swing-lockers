import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ClubSummarySection } from "./_components/ClubSummarySection";
import type { SerializedClubSummary } from "./_components/EditClubSummaryModal";

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
        createdAt: true,
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
  }));

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

      {/* ── Club summaries (primary) ────────────────────────────────────────── */}
      <ClubSummarySection
        batchId={batchId}
        initialSummaries={summaries}
        parserMode={batch.parserMode}
      />

      {/* ── Future import architecture note ────────────────────────────────── */}
      <div className="mt-8 rounded-xl border border-blue-100 bg-blue-50 px-5 py-4 text-sm text-blue-800 font-body">
        <p className="font-semibold font-heading mb-1">
          Final import — coming next
        </p>
        <p>
          After confirming club summaries, the following will be implemented:
        </p>
        <ul className="mt-2 list-disc pl-5 space-y-0.5 text-xs">
          <li>Save club averages into DemoClubTest + ClubTestMetrics</li>
          <li>Create or match existing GolfClient by name / email</li>
          <li>Create DemoSession linked to the client</li>
          <li>GHL follow-up sync trigger</li>
          <li>Swing Locker link generation</li>
        </ul>
      </div>
    </>
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
