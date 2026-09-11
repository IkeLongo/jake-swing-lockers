import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import {
  SWING_LOCKER_SESSION_COOKIE,
  verifySwingLockerSessionToken,
} from "@/lib/auth/swing-locker-session";
import {
  getCustomerSession,
  type CustomerClub,
} from "@/lib/queries/customer-sessions";
import { getExistingPurchaseRequest } from "@/lib/queries/purchase-requests";
import {
  PurchaseRequestTrigger,
  type ModalClub,
} from "./_components/PurchaseRequestTrigger";

// ── Helpers ───────────────────────────────────────────────────────────────────

const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

function formatSessionDateOnly(date: Date | string): string {
  const raw = typeof date === "string" ? date : date.toISOString();
  const match = ISO_DATE_PREFIX.exec(raw);

  if (!match) {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Parse explicit Y/M/D parts so calendar dates don't shift across browser timezones.
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function fmtPrice(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function fmtNum(value: number | null, decimals = 1): string {
  if (value == null) return "—";
  return value.toFixed(decimals);
}

// ── Club metric cell ──────────────────────────────────────────────────────────

function MetricCell({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="bg-white px-4 py-5 text-center">
      <p className="font-body text-2xl font-bold text-slate-900 tabular-nums leading-none">
        {value}
        {unit && (
          <span className="ml-0.5 text-sm font-normal text-slate-400">
            {unit}
          </span>
        )}
      </p>
      <p className="mt-1 font-body text-xs text-slate-400 uppercase tracking-widest">
        {label}
      </p>
    </div>
  );
}

// ── Compact metric cell (used inside comparison section) ─────────────────────

function CompactMetricCell({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="bg-slate-50 px-3 py-3 text-center">
      <p className="font-body text-base font-semibold text-slate-600 tabular-nums leading-none">
        {value}
        {unit && (
          <span className="ml-0.5 text-xs font-normal text-slate-400">
            {unit}
          </span>
        )}
      </p>
      <p className="mt-1 font-body text-[10px] text-slate-400 uppercase tracking-widest">
        {label}
      </p>
    </div>
  );
}

// ── Club card ─────────────────────────────────────────────────────────────────

function ClubCard({
  club,
  comparisonClub,
}: {
  club: CustomerClub;
  comparisonClub?: CustomerClub;
}) {
  const hasMetrics =
    club.clubSpeed != null ||
    club.ballSpeed != null ||
    club.spinRate != null ||
    club.carryDistance != null ||
    club.totalDistance != null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <h3 className="font-heading text-base font-semibold text-slate-900">
          {club.clubType ?? "Club"}
        </h3>
        {club.estimatedPrice != null && (
          <span className="font-body text-sm font-semibold text-emerald-700 bg-emerald-50 rounded-lg px-3 py-1">
            {fmtPrice(club.estimatedPrice)}
          </span>
        )}
      </div>

      {/* Metrics grid */}
      {hasMetrics ? (
        <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-5">
          <MetricCell
            label="Club Speed"
            value={fmtNum(club.clubSpeed)}
            unit="mph"
          />
          <MetricCell
            label="Ball Speed"
            value={fmtNum(club.ballSpeed)}
            unit="mph"
          />
          <MetricCell
            label="Spin Rate"
            value={club.spinRate != null ? String(club.spinRate) : "—"}
            unit="rpm"
          />
          <MetricCell
            label="Carry"
            value={fmtNum(club.carryDistance, 0)}
            unit="yds"
          />
          <MetricCell
            label="Total"
            value={fmtNum(club.totalDistance, 0)}
            unit="yds"
          />
        </div>
      ) : (
        <div className="px-5 py-6 text-center">
          <p className="font-body text-sm text-slate-400">
            No metrics recorded for this club.
          </p>
        </div>
      )}

      {/* Comparison section — attached inside the same card */}
      {comparisonClub && (
        <div className="border-t border-slate-200 bg-slate-50">
          <div className="px-5 pt-3 pb-2">
            <p className="font-body text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
              Compared with
            </p>
            <p className="font-heading text-sm font-semibold text-slate-600 mt-0.5">
              {[
                comparisonClub.brand,
                comparisonClub.model,
                comparisonClub.clubType,
              ]
                .filter(Boolean)
                .join(" ") || "Current Club"}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-px bg-slate-200 sm:grid-cols-5">
            <CompactMetricCell
              label="Club Speed"
              value={fmtNum(comparisonClub.clubSpeed)}
              unit="mph"
            />
            <CompactMetricCell
              label="Ball Speed"
              value={fmtNum(comparisonClub.ballSpeed)}
              unit="mph"
            />
            <CompactMetricCell
              label="Spin Rate"
              value={
                comparisonClub.spinRate != null
                  ? String(comparisonClub.spinRate)
                  : "—"
              }
              unit="rpm"
            />
            <CompactMetricCell
              label="Carry"
              value={fmtNum(comparisonClub.carryDistance, 0)}
              unit="yds"
            />
            <CompactMetricCell
              label="Total"
              value={fmtNum(comparisonClub.totalDistance, 0)}
              unit="yds"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // ── Verify session ─────────────────────────────────────────────────────────
  const cookieStore = await cookies();
  const token = cookieStore.get(SWING_LOCKER_SESSION_COOKIE)?.value;

  if (!token) redirect("/swing-locker/login");

  const result = verifySwingLockerSessionToken(token);
  if (!result.valid) redirect("/swing-locker/login");

  const { golfClientId } = result.payload;

  // ── Resolve route param ────────────────────────────────────────────────────
  const { id: rawId } = await params;
  const sessionId = parseInt(rawId, 10);
  if (isNaN(sessionId)) notFound();

  // ── Load session + check for existing purchase request (parallel) ─────────
  const [session, existingRequest] = await Promise.all([
    getCustomerSession(golfClientId, sessionId),
    getExistingPurchaseRequest(golfClientId, sessionId),
  ]);
  if (!session) notFound();

  // ── Group clubs by role ────────────────────────────────────────────────────
  const demoClubs = session.clubs.filter((c) => c.clubRole === "demo");
  const currentByPairIndex = new Map(
    session.clubs
      .filter((c) => c.clubRole === "current" && c.pairIndex > 0)
      .map((c) => [c.pairIndex, c])
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-3xl">
        {/* Back link */}
        <div className="mb-6">
          <Link
            href="/swing-locker/dashboard"
            className="font-body text-sm text-emerald-600 hover:text-emerald-800 underline underline-offset-2"
          >
            ← Back to Dashboard
          </Link>
        </div>

        {/* Header */}
        <div className="mb-8">
          <span className="inline-block rounded-xl bg-emerald-50 px-4 py-2 text-sm font-semibold tracking-wide text-emerald-700 font-body">
            SWING LOCKER
          </span>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 font-heading">
            Demo Session
          </h1>
          <p className="mt-1 font-body text-sm text-slate-500">
            {formatSessionDateOnly(session.demoDate)}
          </p>
        </div>

        {/* Notes */}
        {session.notes && (
          <div className="mb-8 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <span className="h-3.5 w-0.5 rounded-full bg-emerald-500 shrink-0" />
              <h2 className="font-subheading text-base font-semibold text-slate-800">
                Session Notes
              </h2>
            </div>
            <p className="font-body text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
              {session.notes}
            </p>
          </div>
        )}

        {/* Clubs section */}
        <div className="flex items-center gap-2 mb-4">
          <span className="h-3.5 w-0.5 rounded-full bg-emerald-500 shrink-0" />
          <h2 className="font-subheading text-base font-semibold text-slate-800">
            Clubs Tested
          </h2>
        </div>

        {demoClubs.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
            <p className="font-body text-sm text-slate-500">
              No club data recorded for this session.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {demoClubs.map((club) => (
              <ClubCard
                key={club.id}
                club={club}
                comparisonClub={
                  club.pairIndex > 0
                    ? currentByPairIndex.get(club.pairIndex)
                    : undefined
                }
              />
            ))}
          </div>
        )}

        {/* Estimated total */}
        {session.estimatedTotal != null && (
          <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 flex items-center justify-between shadow-sm">
            <p className="font-body text-sm font-semibold text-emerald-800">
              Estimated Total
            </p>
            <p className="font-heading text-xl font-bold text-emerald-900 tabular-nums">
              {fmtPrice(session.estimatedTotal)}
            </p>
          </div>
        )}

        {/* Purchase request CTA */}
        {demoClubs.length > 0 && (
          existingRequest ? (
            <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-5 py-3.5 flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
              <p className="font-body text-sm font-semibold text-slate-600">
                Purchase request submitted
              </p>
            </div>
          ) : (
            <PurchaseRequestTrigger
              sessionId={session.id}
              clubs={demoClubs.map<ModalClub>((c) => ({
                id: c.id,
                clubType: c.clubType,
                brand: c.brand,
                model: c.model,
                estimatedPrice: c.estimatedPrice,
              }))}
            />
          )
        )}
      </div>
    </main>
  );
}
