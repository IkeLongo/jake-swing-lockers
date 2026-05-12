import type { Metadata } from "next";
import Link from "next/link";
import { ParserDebugForm } from "./_components/ParserDebugForm";

export const metadata: Metadata = {
  title: "Parser Debug — Jake Swing Lockers Staff",
  robots: { index: false, follow: false },
};

export default function ParserDebugPage() {
  return (
    <>
      {/* ── Back nav ────────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <Link
          href="/staff/imports"
          className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 font-body"
        >
          ← Back to imports
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-heading">
              Parser Debug
            </h1>
            <p className="mt-1 text-sm text-slate-500 font-body">
              Upload a CSV or XLSX file to inspect how the parser reads it.
              Nothing is saved to the database.
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700 font-body">
            Debug only
          </span>
        </div>
      </div>

      <ParserDebugForm />
    </>
  );
}
