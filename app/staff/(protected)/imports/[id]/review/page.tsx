import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Review Import — Jake Swing Lockers Staff",
  robots: { index: false, follow: false },
};

export default async function ImportReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <>
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="mb-8">
        <Link
          href="/staff/imports"
          className="mb-6 underline inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 font-body"
        >
          ← Back to Imports
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-heading">
          Review Import
        </h1>
        <p className="mt-1 text-sm text-slate-500 font-body">
          Import ID:{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono text-slate-700">
            {id}
          </code>
        </p>
      </div>

      {/* ── Placeholder ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-dashed border-slate-300 bg-white px-8 py-16 text-center">
        <div className="mb-3 text-4xl">🔍</div>
        <h2 className="text-base font-semibold text-slate-700 font-subheading">
          Review UI coming soon
        </h2>
        <p className="mt-1 text-sm text-slate-400 font-body">
          The import review interface will display mapped club data and let you
          approve or edit before publishing to the client&apos;s Swing Locker.
        </p>
      </div>
    </>
  );
}
