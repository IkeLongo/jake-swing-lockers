import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";

export const metadata: Metadata = {
  title: "Demo Imports — Jake Swing Lockers Staff",
  robots: { index: false, follow: false },
};

const STATUS_STYLES: Record<string, string> = {
  uploaded: "bg-slate-100 text-slate-600",
  parsed: "bg-blue-100 text-blue-700",
  reviewing: "bg-yellow-100 text-yellow-700",
  approved: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
};

export default async function StaffImportsPage() {
  const batches = await db.importBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      originalFileName: true,
      status: true,
      rowCount: true,
      createdAt: true,
    },
  });

  return (
    <>
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-heading">
            Demo Imports
          </h1>
          <p className="mt-1 text-sm text-slate-500 font-body">
            Upload CSV or XLSX exports and review staged rows before saving to
            client records.
          </p>
        </div>
        <Link
          href="/staff/imports/new"
          className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 transition-colors font-body"
        >
          Upload file
        </Link>
      </div>

      {/* ── Empty state ─────────────────────────────────────────────────────── */}
      {batches.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-8 py-16 text-center">
          <div className="mb-3 text-4xl">📂</div>
          <h2 className="text-base font-semibold text-slate-700 font-subheading">
            No imports yet
          </h2>
          <p className="mt-1 text-sm text-slate-400 font-body">
            Upload a CSV or XLSX file to get started.
          </p>
          <Link
            href="/staff/imports/new"
            className="mt-6 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors font-body"
          >
            Upload first file
          </Link>
        </div>
      )}

      {/* ── Batch table ─────────────────────────────────────────────────────── */}
      {batches.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
          <table className="min-w-full text-sm font-body">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  File
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Status
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Rows
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Uploaded
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {batches.map((batch) => {
                const statusStyle =
                  STATUS_STYLES[batch.status] ?? "bg-slate-100 text-slate-600";
                return (
                  <tr key={batch.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800 max-w-xs truncate">
                      {batch.originalFileName}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${statusStyle}`}
                      >
                        {batch.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600 tabular-nums">
                      {batch.rowCount}
                    </td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                      {new Date(batch.createdAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/staff/imports/${batch.id}`}
                        className="text-sm font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
                      >
                        Review →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
