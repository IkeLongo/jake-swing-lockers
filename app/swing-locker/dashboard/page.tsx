import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import {
  SWING_LOCKER_SESSION_COOKIE,
  verifySwingLockerSessionToken,
} from "@/lib/auth/swing-locker-session";
import { getCustomerSessions } from "@/lib/queries/customer-sessions";
import type { CustomerSessionSummary } from "@/lib/queries/customer-sessions";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function fmtPrice(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents);
}

// ── Session card ──────────────────────────────────────────────────────────────

function SessionCard({ session }: { session: CustomerSessionSummary }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1">
        <p className="font-heading text-base font-semibold text-slate-900">
          {fmtDate(session.demoDate)}
        </p>
        <div className="flex items-center gap-3 font-body text-sm text-slate-500">
          <span>{session.clubsTestedCount} club{session.clubsTestedCount !== 1 ? "s" : ""} tested</span>
          {session.estimatedTotal != null && (
            <>
              <span className="text-slate-300">·</span>
              <span className="font-semibold text-slate-700">
                {fmtPrice(session.estimatedTotal)} est.
              </span>
            </>
          )}
        </div>
      </div>
      <Link
        href={`/swing-locker/dashboard/sessions/${session.id}`}
        className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-colors font-body text-center"
      >
        View Session →
      </Link>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function SwingLockerDashboardPage() {
  // ── Verify session ─────────────────────────────────────────────────────────
  const cookieStore = await cookies();
  const token = cookieStore.get(SWING_LOCKER_SESSION_COOKIE)?.value;

  if (!token) redirect("/swing-locker/login");

  const result = verifySwingLockerSessionToken(token);
  if (!result.valid) redirect("/swing-locker/login");

  const { golfClientId } = result.payload;

  // ── Load client and sessions in parallel ───────────────────────────────────
  const [client, sessions] = await Promise.all([
    db.golfClient.findUnique({
      where: { id: golfClientId },
      select: { firstName: true, lastName: true, email: true },
    }),
    getCustomerSessions(golfClientId),
  ]);

  if (!client) redirect("/swing-locker/login");

  const displayName =
    [client.firstName, client.lastName].filter(Boolean).join(" ") ||
    client.email ||
    "there";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-8">
          <span className="inline-block rounded-xl bg-emerald-50 px-4 py-2 text-sm font-semibold tracking-wide text-emerald-700 font-body">
            SWING LOCKER
          </span>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 font-heading">
            Welcome, {displayName}
          </h1>
          <p className="mt-1 text-sm text-slate-500 font-body">
            Your finalized demo sessions are below.
          </p>
        </div>

        {/* Section heading */}
        <div className="flex items-center gap-2 mb-4">
          <span className="h-3.5 w-0.5 rounded-full bg-emerald-500 shrink-0" />
          <h2 className="font-subheading text-base font-semibold text-slate-800">
            Demo Sessions
          </h2>
        </div>

        {/* Sessions list */}
        {sessions.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
            <p className="font-body text-sm text-slate-500">
              No finalized demo sessions yet.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {sessions.map((s) => (
              <SessionCard key={s.id} session={s} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
