import type { Metadata } from "next";
import { getLockerByToken, type LockerData } from "@/lib/queries/locker";

// ── Helpers ────────────────────────────────────────────────────────────────────

type Num = { toString(): string } | number | null | undefined;

function fmt(val: Num, decimals = 1): string {
  if (val == null) return "—";
  return parseFloat(val.toString()).toFixed(decimals);
}

function fmtInt(val: number | null | undefined): string {
  if (val == null) return "—";
  return val.toLocaleString("en-US");
}

function fmtDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SummaryItem({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="px-5 py-4 sm:px-6">
      <p className="font-body text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
        {label}
      </p>
      <p className="font-body text-sm font-medium text-slate-800">
        {value || "—"}
      </p>
    </div>
  );
}

function MetricCell({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
  const isEmpty = value === "—";
  return (
    <div className="bg-white px-4 py-5 text-center">
      <p className="font-body text-2xl font-bold text-slate-900 leading-none">
        {value}
        {!isEmpty && unit && (
          <span className="font-body text-sm font-medium text-slate-400 ml-1">
            {unit}
          </span>
        )}
      </p>
      <p className="font-body text-xs text-slate-400 mt-2 leading-tight">{label}</p>
    </div>
  );
}

function SectionAccent({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="px-5 py-4 border-b border-slate-100 sm:px-6">
      <div className="flex items-center gap-2">
        <span className="h-3.5 w-0.5 rounded-full bg-emerald-500 shrink-0" />
        <h2 className="font-subheading text-base font-semibold text-slate-800">
          {title}
        </h2>
      </div>
      {subtitle && (
        <p className="font-body text-xs text-slate-400 mt-0.5 pl-4">{subtitle}</p>
      )}
    </div>
  );
}

// ── Comparison Card ────────────────────────────────────────────────────────────

type ClubTest = LockerData["clubTests"][number];

function ClubSection({
  club,
  label,
  isRecommended = false,
}: {
  club: ClubTest | undefined;
  label: string;
  isRecommended?: boolean;
}) {
  if (!club) return null;

  const clubLabel =
    [club.brand, club.model].filter(Boolean).join(" ") || club.clubType || "—";
  const specLine = [club.shaft, club.loft].filter(Boolean).join(" · ");

  const metrics: Array<{ label: string; value: string; unit: string }> = [
    { label: "Club Speed", value: fmt(club.metrics?.clubSpeed), unit: "mph" },
    { label: "Ball Speed", value: fmt(club.metrics?.ballSpeed), unit: "mph" },
    { label: "Smash Factor", value: fmt(club.metrics?.smashFactor, 2), unit: "" },
    { label: "Carry", value: fmt(club.metrics?.carryDistance, 0), unit: "yds" },
    { label: "Total", value: fmt(club.metrics?.totalDistance, 0), unit: "yds" },
    { label: "Launch", value: fmt(club.metrics?.launchAngle), unit: "°" },
    { label: "Spin Rate", value: fmtInt(club.metrics?.spinRate), unit: "rpm" },
    { label: "Dispersion", value: fmt(club.metrics?.dispersion), unit: "yds" },
  ];

  const hasMetrics = club.metrics !== null;

  return (
    <div>
      <div
        className={`px-5 py-3 flex items-center justify-between sm:px-6 ${
          isRecommended
            ? "bg-emerald-50 border-b border-emerald-100"
            : "bg-slate-50 border-b border-slate-100"
        }`}
      >
        <div className="flex items-center gap-2.5">
          <span
            className={`h-2 w-2 rounded-full shrink-0 ${
              isRecommended ? "bg-emerald-500" : "bg-slate-400"
            }`}
          />
          <div>
            <p
              className={`font-subheading text-sm font-semibold leading-none ${
                isRecommended ? "text-emerald-800" : "text-slate-700"
              }`}
            >
              {label}
            </p>
            <p className="font-body text-xs text-slate-500 mt-0.5">
              {clubLabel}
              {specLine ? ` · ${specLine}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {club.clubType && (
            <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 font-body">
              {club.clubType}
            </span>
          )}
          {isRecommended && (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white font-body">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Recommended
            </span>
          )}
        </div>
      </div>

      {hasMetrics && (
        <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-4">
          {metrics.map((m) => (
            <MetricCell key={m.label} label={m.label} value={m.value} unit={m.unit} />
          ))}
        </div>
      )}

      {club.notes?.trim() && (
        <div className="px-5 py-3 sm:px-6">
          <p className="font-body text-xs text-slate-500 italic leading-relaxed">
            {club.notes}
          </p>
        </div>
      )}
    </div>
  );
}

function ComparisonCard({
  demo,
  current,
  pairNumber,
}: {
  demo: ClubTest | undefined;
  current: ClubTest | undefined;
  pairNumber: number;
}) {
  const isRecommended = demo?.isRecommended ?? false;

  return (
    <div
      className={`rounded-xl border shadow-sm overflow-hidden ${
        isRecommended
          ? "border-emerald-300 ring-2 ring-emerald-300/50"
          : "border-slate-200"
      }`}
    >
      <ClubSection club={demo} label="Demo Club" isRecommended={isRecommended} />

      {current && (
        <div className="flex items-center gap-3 px-5 py-2 bg-white border-y border-slate-100 sm:px-6">
          <div className="h-px flex-1 bg-slate-100" />
          <span className="font-body text-xs font-semibold text-slate-400 uppercase tracking-wider">
            vs. your current club
          </span>
          <div className="h-px flex-1 bg-slate-100" />
        </div>
      )}

      {current && <ClubSection club={current} label="Your Current Club" />}
    </div>
  );
}

// ── Not-Found State ────────────────────────────────────────────────────────────

function LockerNotFound() {
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      <div className="h-1 bg-gradient-to-r from-emerald-700 via-emerald-500 to-emerald-400" />
      <div className="flex-1 flex flex-col items-center justify-center px-4 text-center">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-slate-800 mb-6">
          <svg
            className="h-8 w-8 text-slate-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
            />
          </svg>
        </div>
        <h1 className="font-heading text-2xl font-bold text-white mb-3">
          Locker Not Found
        </h1>
        <p className="font-body text-sm text-slate-400 max-w-sm leading-relaxed">
          This locker link may be invalid or has expired. Please contact your
          sales rep for a new link.
        </p>
      </div>
    </div>
  );
}

// ── Metadata ───────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const locker = await getLockerByToken(token);

  if (!locker) {
    return { title: "Locker Not Found | Jake Swing Lockers" };
  }

  const name = [locker.client.firstName, locker.client.lastName]
    .filter(Boolean)
    .join(" ");

  return {
    title: name ? `${name}'s Swing Locker` : "Your Swing Locker",
    robots: { index: false, follow: false },
  };
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function SwingLockerPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const locker = await getLockerByToken(token);

  if (!locker) return <LockerNotFound />;

  const { client, clubTests } = locker;

  const clientName =
    [client.firstName, client.lastName].filter(Boolean).join(" ") || "Golfer";

  // Group club tests by pairIndex into comparison pairs
  const pairMap = new Map<number, { demo?: ClubTest; current?: ClubTest }>();
  for (const club of clubTests) {
    const entry = pairMap.get(club.pairIndex) ?? {};
    if (club.clubRole === "demo") entry.demo = club;
    else entry.current = club;
    pairMap.set(club.pairIndex, entry);
  }
  const pairs = Array.from(pairMap.entries()).sort(([a], [b]) => a - b);

  const hasNotes = !!locker.notes?.trim();

  return (
    <div className="min-h-screen bg-slate-50 font-body">
      {/* ── Top accent bar ─────────────────────────────────────────────────── */}
      <div className="h-1 bg-gradient-to-r from-emerald-700 via-emerald-500 to-emerald-400" />

      {/* ── Brand header ───────────────────────────────────────────────────── */}
      <header className="bg-slate-900 px-4 py-3 sm:px-6">
        <div className="mx-auto max-w-4xl flex items-center justify-between">
          <span className="font-heading text-sm font-bold tracking-wider text-white uppercase">
            Jacob Longoria Golf Sales
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-400 ring-1 ring-inset ring-emerald-500/20 font-body">
            <svg
              className="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
              />
            </svg>
            Secure Locker
          </span>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section
        className="relative px-4 py-20 sm:px-6 sm:py-28 min-h-[420px] flex items-center"
        style={{
          backgroundImage: "url('/tiger-woods-swing-sequence.png')",
          backgroundSize: "cover",
          backgroundPosition: "center 20%",
          backgroundRepeat: "no-repeat",
        }}
      >
        {/* Cinematic overlay: dark top/bottom vignette + emerald depth tint */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, rgba(2,6,23,0.72) 0%, rgba(2,6,23,0.55) 40%, rgba(2,6,23,0.68) 100%)",
          }}
        />
        {/* Subtle left-edge emerald bleed */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to right, rgba(5,46,22,0.45) 0%, transparent 55%)",
          }}
        />
        {/* Radial glow behind text */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(2,6,23,0.72) 0%, transparent 100%)",
          }}
        />
        <div className="relative z-10 mx-auto max-w-4xl w-full text-center">
          <p className="font-body text-xs font-semibold uppercase tracking-widest text-emerald-400 mb-4">
            Personal Demo Recap
          </p>
          <h1 className="font-heading text-4xl font-bold text-white sm:text-5xl mb-3">
            Your Swing Locker
          </h1>
          <p className="font-heading text-xl font-semibold text-slate-300 mb-7">
            {clientName}
          </p>
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 backdrop-blur-sm">
            <svg
              className="h-3.5 w-3.5 text-emerald-400 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5"
              />
            </svg>
            <span className="font-body text-xs text-slate-300">
              {fmtDate(locker.demoDate)}
            </span>
          </div>
        </div>
      </section>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 space-y-5">

        {/* Session Summary */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 sm:px-6">
            <h2 className="font-subheading text-base font-semibold text-slate-800">
              Session Summary
            </h2>
          </div>
          <div className="px-5 py-4 sm:px-6">
            <SummaryItem label="Your Goal" value={locker.clientGoal} />
          </div>
        </div>

        {/* Demo Club Comparisons */}
        {pairs.length > 0 && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 px-1">
              <span className="h-3.5 w-0.5 rounded-full bg-emerald-500 shrink-0" />
              <h2 className="font-subheading text-base font-semibold text-slate-800">
                Demo Clubs
              </h2>
              <span className="ml-auto font-body text-xs text-slate-400">
                {pairs.length} club{pairs.length !== 1 ? "s" : ""} tested
              </span>
            </div>
            {pairs.map(([pairIndex, { demo, current }]) => (
              <ComparisonCard
                key={pairIndex}
                demo={demo}
                current={current}
                pairNumber={pairIndex + 1}
              />
            ))}
          </div>
        )}

        {/* Notes from rep */}
        {hasNotes && (
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <SectionAccent
              title={`A Note From ${locker.salesRep ?? "Your Rep"}`}
            />
            <div className="px-5 py-5 sm:px-6">
              <blockquote className="pl-4 border-l-2 border-emerald-300">
                <p className="font-body text-sm text-slate-600 italic leading-relaxed">
                  {locker.notes}
                </p>
              </blockquote>
              {locker.salesRep && (
                <p className="mt-3 font-body text-xs text-slate-400">
                  — {locker.salesRep}
                </p>
              )}
            </div>
          </div>
        )}

        {/* CTA */}
        <div className="rounded-xl bg-slate-900 px-6 py-10 text-center shadow-sm">
          <p className="font-body text-xs font-semibold uppercase tracking-widest text-emerald-400 mb-3">
            Next Step
          </p>
          <h2 className="font-heading text-2xl font-bold text-white mb-2">
            Ready to move forward?
          </h2>
          <p className="font-body text-sm text-slate-400 mb-8 max-w-sm mx-auto leading-relaxed">
            {locker.salesRep
              ? `Connect with ${locker.salesRep} to lock in your setup, book your follow-up fitting, or request a custom quote.`
              : "Connect with your sales rep to lock in your setup, book a follow-up fitting, or request a custom quote."}
          </p>
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center">
            <a
              href="mailto:sales@jakegolf.com"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 active:bg-emerald-800 transition-colors font-body"
            >
              <svg
                className="h-4 w-4 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5"
                />
              </svg>
              Book Follow-Up
            </a>
            <a
              href="mailto:sales@jakegolf.com?subject=Quote%20Request"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-6 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-700 active:bg-slate-600 transition-colors font-body"
            >
              <svg
                className="h-4 w-4 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                />
              </svg>
              Request Quote
            </a>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center py-4">
          <p className="font-body text-xs text-slate-400">
            This locker is private and secured. &copy;{" "}
            {new Date().getFullYear()} Jake Swing Lockers
          </p>
        </div>
      </main>
    </div>
  );
}