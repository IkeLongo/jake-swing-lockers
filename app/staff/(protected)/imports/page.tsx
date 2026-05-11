import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Demo Imports — Jake Swing Lockers Staff",
  robots: { index: false, follow: false },
};

export default function StaffImportsPage() {
  return (
    <>
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-heading">
            Demo Imports
          </h1>
          <p className="mt-1 text-sm text-slate-500 font-body">
            Upload TrackMan CSV exports and review club data before publishing
            to a client&apos;s Swing Locker.
          </p>
        </div>
        {/* Placeholder — upload button wired in a future phase */}
        <button
          disabled
          className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white opacity-40 cursor-not-allowed font-body"
        >
          Upload CSV
        </button>
      </div>

      {/* ── Empty state ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-dashed border-slate-300 bg-white px-8 py-16 text-center">
        <div className="mb-3 text-4xl">📂</div>
        <h2 className="text-base font-semibold text-slate-700 font-subheading">
          No imports yet
        </h2>
        <p className="mt-1 text-sm text-slate-400 font-body">
          CSV import functionality is coming soon. Check back after the next
          release.
        </p>
        <Link
          href="/staff/dashboard"
          className="mt-6 inline-block text-sm font-medium text-emerald-700 hover:text-emerald-800 hover:underline font-body"
        >
          ← Back to Dashboard
        </Link>
      </div>
    </>
  );
}
