"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EditRowModal } from "./EditRowModal";

type RowStatus = "pending" | "approved" | "rejected";

export interface ImportRow {
  id: number;
  rowIndex: number;
  rawData: Record<string, unknown>;
  status: string;
  validationErrors: unknown;
}

interface Props {
  batchId: number;
  rows: ImportRow[];
  columns: string[];
  isTruncated: boolean;
  displayLimit: number;
  totalRowCount: number;
}

const ROW_STATUS_STYLES: Record<string, string> = {
  pending: "bg-slate-100 text-slate-600",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
};

export function ImportReviewActions({
  batchId,
  rows,
  columns,
  isTruncated,
  displayLimit,
  totalRowCount,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<ImportRow | null>(null);

  const isDisabled = loading !== null;

  async function updateRow(rowId: number, status: RowStatus) {
    setLoading(`row-${rowId}`);
    setError(null);
    try {
      const res = await fetch(
        `/api/staff/imports/${batchId}/rows/${rowId}/status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(json.error ?? "Update failed");
      } else {
        router.refresh();
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(null);
    }
  }

  async function bulkUpdate(status: RowStatus) {
    setLoading("bulk");
    setError(null);
    try {
      const res = await fetch(
        `/api/staff/imports/${batchId}/rows/bulk-status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(json.error ?? "Bulk update failed");
      } else {
        router.refresh();
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div>
      {/* ── Error banner ────────────────────────────────────────────────────── */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-body">
          {error}
        </div>
      )}

      {/* ── Bulk actions ────────────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-500 font-body">
          Bulk:
        </span>
        <button
          onClick={() => bulkUpdate("approved")}
          disabled={isDisabled}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 transition-colors font-body"
        >
          {loading === "bulk" ? "Updating…" : "Approve all"}
        </button>
        <button
          onClick={() => bulkUpdate("rejected")}
          disabled={isDisabled}
          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40 transition-colors font-body"
        >
          {loading === "bulk" ? "Updating…" : "Reject all"}
        </button>
        <button
          onClick={() => bulkUpdate("pending")}
          disabled={isDisabled}
          className="rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-40 transition-colors font-body"
        >
          {loading === "bulk" ? "Updating…" : "Reset all"}
        </button>
      </div>

      {/* ── Truncation warning ──────────────────────────────────────────────── */}
      {isTruncated && (
        <div className="mb-4 rounded-lg bg-yellow-50 px-4 py-3 text-sm text-yellow-800 font-body">
          Showing first {displayLimit} of {totalRowCount} rows. Bulk actions
          apply to <strong>all</strong> rows.
        </div>
      )}

      {/* ── Row table ───────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
        <table className="min-w-full text-sm font-body">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="w-10 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                #
              </th>
              <th className="w-24 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                Status
              </th>
              {columns.map((col) => (
                <th
                  key={col}
                  className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  {col}
                </th>
              ))}
              <th className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const isRowLoading = loading === `row-${row.id}`;
              const statusStyle =
                ROW_STATUS_STYLES[row.status] ?? "bg-slate-100 text-slate-600";
              const hasErrors =
                row.validationErrors !== null &&
                row.validationErrors !== undefined;

              return (
                <tr
                  key={row.id}
                  className={`hover:bg-slate-50 ${hasErrors ? "bg-red-50/40" : ""}`}
                >
                  <td className="px-3 py-2 text-xs text-slate-400 tabular-nums">
                    {row.rowIndex + 1}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${statusStyle}`}
                    >
                      {row.status}
                    </span>
                  </td>
                  {columns.map((col) => (
                    <td
                      key={col}
                      className="max-w-xs truncate whitespace-nowrap px-3 py-2 text-slate-700"
                      title={String(row.rawData[col] ?? "")}
                    >
                      {String(row.rawData[col] ?? "")}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1.5">
                      {row.status !== "approved" && (
                        <button
                          onClick={() => updateRow(row.id, "approved")}
                          disabled={isDisabled}
                          className="rounded px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40 transition-colors font-body"
                        >
                          {isRowLoading ? "…" : "Approve"}
                        </button>
                      )}
                      {row.status !== "rejected" && (
                        <button
                          onClick={() => updateRow(row.id, "rejected")}
                          disabled={isDisabled}
                          className="rounded px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 transition-colors font-body"
                        >
                          {isRowLoading ? "…" : "Reject"}
                        </button>
                      )}
                      {row.status !== "pending" && (
                        <button
                          onClick={() => updateRow(row.id, "pending")}
                          disabled={isDisabled}
                          className="rounded px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 transition-colors font-body"
                        >
                          {isRowLoading ? "…" : "Reset"}
                        </button>
                      )}
                      <button
                        onClick={() => setEditingRow(row)}
                        disabled={isDisabled}
                        className="rounded px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 transition-colors font-body"
                      >
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Edit modal ──────────────────────────────────────────────────────── */}
      {editingRow && (
        <EditRowModal
          batchId={batchId}
          row={editingRow}
          onClose={() => setEditingRow(null)}
        />
      )}
    </div>
  );
}
