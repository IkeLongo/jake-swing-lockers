import type { Metadata } from "next";
import { getLockerByToken, type LockerData } from "@/lib/queries/locker";

// ── Types ──────────────────────────────────────────────────────────────────────

type ClubTest = LockerData["clubTests"][number];
type MetricsRecord = NonNullable<ClubTest["metrics"]>;
type Num = { toString(): string } | number | null | undefined;

// ── Numeric helpers ────────────────────────────────────────────────────────────

function numVal(v: Num): number | null {
  if (v == null) return null;
  const n = parseFloat(v.toString());
  return isNaN(n) ? null : n;
}

function fmt(val: Num, decimals = 1): string {
  const n = numVal(val);
  return n == null ? "—" : n.toFixed(decimals);
}

function fmtInt(val: Num): string {
  const n = numVal(val);
  return n == null ? "—" : Math.round(n).toLocaleString("en-US");
}

function fmtDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

// ── Delta helpers ──────────────────────────────────────────────────────────────

/** 1 = higher is better, -1 = lower is better */
const DIR: Record<keyof MetricsRecord, 1 | -1> = {
  clubSpeed:     1,
  ballSpeed:     1,
  smashFactor:   1,
  carryDistance: 1,
  totalDistance: 1,
  launchAngle:   1,
  spinRate:      -1,
  dispersion:    -1,
};

function calcDelta(
  demoVal: Num,
  currVal: Num,
  key: keyof MetricsRecord
): { raw: number; good: boolean; neutral: boolean } | null {
  const d = numVal(demoVal);
  const c = numVal(currVal);
  if (d == null || c == null) return null;
  const raw = d - c;
  const neutral = Math.abs(raw) < 0.005;
  return { raw, good: raw * DIR[key] > 0, neutral };
}

// ── Auto-generated insights ────────────────────────────────────────────────────

function buildInsights(
  dm: MetricsRecord,
  cm: MetricsRecord
): Array<{ text: string; positive: boolean }> {
  const out: Array<{ text: string; positive: boolean }> = [];

  const carry = calcDelta(dm.carryDistance, cm.carryDistance, "carryDistance");
  if (carry && !carry.neutral && Math.abs(carry.raw) >= 3) {
    const y = Math.round(Math.abs(carry.raw));
    out.push({ text: carry.good ? `${y} more yards carry` : `${y} fewer yards carry`, positive: carry.good });
  }

  const bs = calcDelta(dm.ballSpeed, cm.ballSpeed, "ballSpeed");
  if (bs && !bs.neutral && Math.abs(bs.raw) >= 1.5) {
    out.push({ text: bs.good ? "Higher ball speed" : "Lower ball speed", positive: bs.good });
  }

  const disp = calcDelta(dm.dispersion, cm.dispersion, "dispersion");
  if (disp && !disp.neutral && Math.abs(disp.raw) >= 1) {
    out.push({ text: disp.good ? "Tighter miss pattern" : "Wider miss pattern", positive: disp.good });
  }

  const smash = calcDelta(dm.smashFactor, cm.smashFactor, "smashFactor");
  if (smash && !smash.neutral && Math.abs(smash.raw) >= 0.01) {
    out.push({ text: smash.good ? "Better energy transfer" : "Lower efficiency", positive: smash.good });
  }

  const spin = calcDelta(dm.spinRate, cm.spinRate, "spinRate");
  if (spin && !spin.neutral && Math.abs(spin.raw) >= 200) {
    out.push({ text: spin.good ? "Optimized spin rate" : "Higher spin rate", positive: spin.good });
  }

  return out;
}

// ── Metric definitions (display order) ────────────────────────────────────────

const METRIC_DEFS: Array<{
  key: keyof MetricsRecord;
  label: string;
  unit: string;
  decimals: number;
  isInt?: boolean;
  neutralDelta?: boolean;
}> = [
  { key: "clubSpeed",     label: "Club Speed",   unit: "mph", decimals: 1 },
  { key: "ballSpeed",     label: "Ball Speed",   unit: "mph", decimals: 1 },
  { key: "smashFactor",   label: "Smash Factor", unit: "",    decimals: 2 },
  { key: "carryDistance", label: "Carry",        unit: "yds", decimals: 0 },
  { key: "totalDistance", label: "Total",        unit: "yds", decimals: 0 },
  { key: "dispersion",    label: "Dispersion",   unit: "yds", decimals: 1 },
  { key: "launchAngle",   label: "Launch Angle", unit: "°",   decimals: 1, neutralDelta: true },
  { key: "spinRate",      label: "Spin Rate",    unit: "rpm", decimals: 0, isInt: true, neutralDelta: true },
];

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

function MetricCell({ label, value, unit }: { label: string; value: string; unit: string }) {
  const isEmpty = value === "—";
  return (
    <div className="bg-white px-4 py-5 text-center">
      <p className="font-body text-2xl font-bold text-slate-900 leading-none">
        {value}
        {!isEmpty && unit && (
          <span className="font-body text-sm font-medium text-slate-400 ml-1">{unit}</span>
        )}
      </p>
      <p className="font-body text-xs text-slate-400 mt-2 leading-tight">{label}</p>
    </div>
  );
}

// ── Performance headline deltas ───────────────────────────────────────────────

function HeadlineDeltas({ demo, current }: { demo: ClubTest; current: ClubTest }) {
  if (!demo.metrics || !current.metrics) return null;
  const dm = demo.metrics;
  const cm = current.metrics;

  const candidates: Array<{ key: keyof MetricsRecord; label: string; unit: string; decimals: number; isInt?: boolean }> = [
    { key: "carryDistance", label: "Carry",       unit: "yds", decimals: 0 },
    { key: "ballSpeed",     label: "Ball Speed",  unit: "mph", decimals: 1 },
    { key: "dispersion",    label: "Dispersion",  unit: "yds", decimals: 1 },
    { key: "smashFactor",   label: "Efficiency",  unit: "",    decimals: 2 },
    { key: "totalDistance", label: "Total Dist.", unit: "yds", decimals: 0 },
    { key: "clubSpeed",     label: "Club Speed",  unit: "mph", decimals: 1 },
  ];

  const items = candidates
    .map((c) => ({ ...c, d: calcDelta(dm[c.key], cm[c.key], c.key) }))
    .filter((c) => c.d !== null)
    .slice(0, 4);

  if (items.length === 0) return null;

  return (
    <div className="px-5 py-6 sm:px-6 bg-slate-900 border-b border-slate-800">
      <p className="font-body text-xs font-semibold uppercase tracking-widest text-emerald-400 mb-5">
        Performance Gains vs. Your Current Club
      </p>
      <div className={`grid gap-4 ${items.length <= 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4"}`}>
        {items.map(({ key, label, unit, decimals, isInt, d }) => {
          const sign = d!.raw > 0 ? "+" : "";
          const valStr = isInt
            ? `${sign}${Math.round(d!.raw).toLocaleString("en-US")}`
            : `${sign}${d!.raw.toFixed(decimals)}`;
          const color = d!.neutral
            ? "text-slate-500"
            : d!.good
            ? "text-emerald-400"
            : "text-red-400";
          return (
            <div key={key} className="text-center">
              <p className={`font-heading text-3xl font-bold leading-none ${color}`}>
                {valStr}
                {unit && (
                  <span className="font-body text-base font-medium ml-1 opacity-70">{unit}</span>
                )}
              </p>
              <p className="font-body text-xs text-slate-500 mt-2 uppercase tracking-wide">{label}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Carry distance visual bars ─────────────────────────────────────────────────

function CarryBars({
  demoCarry,
  currentCarry,
  demoName,
  currentName,
}: {
  demoCarry: number | null;
  currentCarry: number | null;
  demoName: string;
  currentName: string;
}) {
  if (!demoCarry && !currentCarry) return null;
  const max = Math.max(demoCarry ?? 0, currentCarry ?? 0);
  if (max === 0) return null;
  const scale = (v: number) => Math.round((v / max) * 88);

  return (
    <div className="px-5 py-5 sm:px-6 border-b border-slate-100">
      <p className="font-body text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">
        Carry Distance
      </p>
      <div className="space-y-4">
        {demoCarry != null && (
          <div className="flex items-center gap-3">
            <div className="w-28 shrink-0 text-right">
              <p className="font-body text-xs font-semibold text-slate-700 leading-tight truncate">{demoName}</p>
              <p className="font-body text-xs text-slate-400 leading-tight">Demo Club</p>
            </div>
            <div className="flex-1 bg-slate-100 rounded-full h-3.5 overflow-hidden">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${scale(demoCarry)}%` }} />
            </div>
            <span className="font-body text-sm font-bold text-slate-800 w-16 shrink-0">{Math.round(demoCarry)} yds</span>
          </div>
        )}
        {currentCarry != null && (
          <div className="flex items-center gap-3">
            <div className="w-28 shrink-0 text-right">
              <p className="font-body text-xs font-semibold text-slate-600 leading-tight truncate">{currentName}</p>
              <p className="font-body text-xs text-slate-400 leading-tight">Your Club</p>
            </div>
            <div className="flex-1 bg-slate-100 rounded-full h-3.5 overflow-hidden">
              <div className="h-full rounded-full bg-slate-400" style={{ width: `${scale(currentCarry)}%` }} />
            </div>
            <span className="font-body text-sm font-bold text-slate-500 w-16 shrink-0">{Math.round(currentCarry)} yds</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Insight pills ───────────────────────────────────────────────────────────────

function InsightPills({ insights }: { insights: Array<{ text: string; positive: boolean }> }) {
  if (insights.length === 0) return null;
  return (
    <div className="px-5 py-4 sm:px-6 bg-slate-50 border-b border-slate-100">
      <div className="flex flex-wrap gap-2">
        {insights.map(({ text, positive }) => (
          <span
            key={text}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold font-body ${
              positive ? "bg-emerald-100 text-emerald-700" : "bg-red-50 text-red-600"
            }`}
          >
            {positive ? (
              <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            ) : (
              <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            )}
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Metrics table (side-by-side Δ or solo grid) ──────────────────────────────────

function MetricsComparison({ demo, current }: { demo: ClubTest; current?: ClubTest }) {
  const dm = demo.metrics;
  const cm = current?.metrics;
  if (!dm && !cm) return null;

  if (dm && cm) {
    const rows = METRIC_DEFS.map(({ key, label, unit, decimals, isInt, neutralDelta }) => {
      const dv = dm[key];
      const cv = cm[key];
      const dn = numVal(dv);
      const cn = numVal(cv);
      if (dn == null && cn == null) return null;
      const dStr = isInt ? fmtInt(dv) : fmt(dv, decimals);
      const cStr = isInt ? fmtInt(cv) : fmt(cv, decimals);
      const d = calcDelta(dv, cv, key);
      let deltaStr = "—";
      if (d) {
        const sign = d.raw > 0 ? "+" : "";
        const raw = isInt
          ? `${sign}${Math.round(d.raw).toLocaleString("en-US")}`
          : `${sign}${d.raw.toFixed(decimals)}`;
        deltaStr = unit ? `${raw} ${unit}` : raw;
      }
      const deltaColor =
        !d || d.neutral || neutralDelta
          ? "text-slate-700"
          : d.good
          ? "text-emerald-600 font-bold"
          : "text-red-500 font-bold";
      return { key, label, unit, dStr, cStr, deltaStr, deltaColor, dn, cn };
    }).filter(Boolean);

    if (rows.length === 0) return null;

    return (
      <div className="border-b border-slate-100">
        <div className="grid grid-cols-[1fr_5rem_5rem_6rem] px-5 py-2.5 bg-slate-50 border-b border-slate-100 sm:px-6">
          <span className="font-body text-xs font-semibold uppercase tracking-widest text-slate-300" />
          <span className="font-body text-xs font-semibold uppercase tracking-widest text-emerald-600 text-right">Demo</span>
          <span className="font-body text-xs font-semibold uppercase tracking-widest text-slate-400 text-right">Yours</span>
          <span className="font-body text-xs font-semibold uppercase tracking-widest text-slate-400 text-right">Change</span>
        </div>
        {rows.map((row, i) => (
          <div
            key={row!.key}
            className={`grid grid-cols-[1fr_5rem_5rem_6rem] px-5 py-3 sm:px-6 ${
              i % 2 === 0 ? "bg-white" : "bg-slate-50/60"
            }`}
          >
            <span className="font-body text-sm text-slate-600">{row!.label}</span>
            <span className="font-body text-sm font-semibold text-slate-900 text-right tabular-nums">
              {row!.dStr}
              {row!.dn != null && row!.unit && <span className="text-xs text-slate-400 ml-0.5">{row!.unit}</span>}
            </span>
            <span className="font-body text-sm text-slate-500 text-right tabular-nums">
              {row!.cStr}
              {row!.cn != null && row!.unit && <span className="text-xs text-slate-400 ml-0.5">{row!.unit}</span>}
            </span>
            <span className={`font-body text-xs text-right tabular-nums ${row!.deltaColor}`}>
              {row!.deltaStr}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // Solo grid (no current club)
  if (dm) {
    const cells = [
      { label: "Club Speed",   value: fmt(dm.clubSpeed),        unit: "mph" },
      { label: "Ball Speed",   value: fmt(dm.ballSpeed),        unit: "mph" },
      { label: "Smash Factor", value: fmt(dm.smashFactor, 2),   unit: ""    },
      { label: "Carry",        value: fmt(dm.carryDistance, 0), unit: "yds" },
      { label: "Total",        value: fmt(dm.totalDistance, 0), unit: "yds" },
      { label: "Launch",       value: fmt(dm.launchAngle),      unit: "°"   },
      { label: "Spin Rate",    value: fmtInt(dm.spinRate),      unit: "rpm" },
      { label: "Dispersion",   value: fmt(dm.dispersion),       unit: "yds" },
    ];
    return (
      <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-4">
        {cells.map((m) => (
          <MetricCell key={m.label} label={m.label} value={m.value} unit={m.unit} />
        ))}
      </div>
    );
  }

  return null;
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

function ComparisonCard({
  demo,
  current,
}: {
  demo: ClubTest | undefined;
  current: ClubTest | undefined;
}) {
  if (!demo) return null;

  const isRecommended = demo.isRecommended ?? false;
  const hasComparison = !!current;

  const demoLabel = [demo.brand, demo.model].filter(Boolean).join(" ") || demo.clubType || "Demo Club";
  const demoSpec  = [demo.shaft, demo.loft].filter(Boolean).join(" · ");
  const currLabel = current
    ? [current.brand, current.model].filter(Boolean).join(" ") || current.clubType || "Current Club"
    : null;

  const insights =
    hasComparison && demo.metrics && current!.metrics
      ? buildInsights(demo.metrics, current!.metrics)
      : [];

  const demoCarry    = numVal(demo.metrics?.carryDistance);
  const currentCarry = current ? numVal(current.metrics?.carryDistance) : null;

  return (
    <div
      className={`rounded-xl border shadow-sm overflow-hidden ${
        isRecommended
          ? "border-emerald-300 ring-2 ring-emerald-300/50"
          : "border-slate-200"
      }`}
    >
      {/* Card header */}
      <div
        className={`px-5 py-4 sm:px-6 flex items-start justify-between ${
          isRecommended ? "bg-emerald-50 border-b border-emerald-100" : "bg-slate-50 border-b border-slate-100"
        }`}
      >
        <div className="flex items-start gap-2.5">
          <span className={`mt-0.5 h-2.5 w-2.5 rounded-full shrink-0 ${isRecommended ? "bg-emerald-500" : "bg-slate-400"}`} />
          <div>
            <p className={`font-subheading text-base font-bold leading-tight ${isRecommended ? "text-emerald-900" : "text-slate-800"}`}>
              {demoLabel}
            </p>
            {demoSpec && <p className="font-body text-xs text-slate-500 mt-0.5">{demoSpec}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          {demo.clubType && (
            <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 font-body">
              {demo.clubType}
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

      {/* Performance headline deltas — only shown with a current club comparison */}
      {hasComparison && <HeadlineDeltas demo={demo} current={current!} />}

      {/* Carry distance bars */}
      {hasComparison && (demoCarry != null || currentCarry != null) && (
        <CarryBars
          demoCarry={demoCarry}
          currentCarry={currentCarry}
          demoName={demoLabel}
          currentName={currLabel ?? "Current Club"}
        />
      )}

      {/* Insight pills */}
      {insights.length > 0 && <InsightPills insights={insights} />}

      {/* Metrics — comparison table or solo grid */}
      {demo.metrics && (
        <>
          {hasComparison && (
            <div className="px-5 py-2.5 sm:px-6 bg-white border-b border-slate-100">
              <p className="font-body text-xs font-semibold uppercase tracking-widest text-slate-400">Full Numbers</p>
            </div>
          )}
          <MetricsComparison demo={demo} current={current} />
        </>
      )}

      {/* Demo club notes */}
      {demo.notes?.trim() && (
        <div className="px-5 py-3 sm:px-6 bg-white border-t border-slate-100">
          <p className="font-body text-xs text-slate-500 italic leading-relaxed">{demo.notes}</p>
        </div>
      )}

      {/* Current club footer */}
      {hasComparison && (
        <div className="px-5 py-3 sm:px-6 bg-slate-50 border-t border-slate-200 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-slate-400 shrink-0" />
          <p className="font-body text-xs text-slate-500">
            <span className="font-semibold text-slate-600">Your current club: </span>
            {currLabel}
            {(current?.shaft || current?.loft)
              ? ` · ${[current!.shaft, current!.loft].filter(Boolean).join(" · ")}`
              : ""}
          </p>
        </div>
      )}
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
              <ComparisonCard key={pairIndex} demo={demo} current={current} />
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
            {new Date().getFullYear()} JL Golf Sales
          </p>
        </div>
      </main>
    </div>
  );
}