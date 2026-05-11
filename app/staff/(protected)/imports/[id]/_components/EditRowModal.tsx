"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ImportRow } from "./ImportReviewActions";

interface Props {
  batchId: number;
  row: ImportRow;
  onClose: () => void;
}

export function EditRowModal({ batchId, row, onClose }: Props) {
  const router = useRouter();
  const [fields, setFields] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const [k, v] of Object.entries(row.rawData)) {
      init[k] = String(v ?? "");
    }
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Open native dialog on mount; close on backdrop click
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  function handleBackdropClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === dialogRef.current && !saving) onClose();
  }

  function handleChange(key: string, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/staff/imports/${batchId}/rows/${row.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rawData: fields }),
        },
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(json.error ?? "Save failed");
        setSaving(false);
        return;
      }

      // Automatically approve the row after saving
      const approveRes = await fetch(
        `/api/staff/imports/${batchId}/rows/${row.id}/status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "approved" }),
        },
      );
      if (!approveRes.ok) {
        const json = (await approveRes.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(json.error ?? "Saved but failed to approve — please approve manually.");
        setSaving(false);
        return;
      }

      router.refresh();
      onClose();
    } catch {
      setError("Network error — please try again.");
      setSaving(false);
    }
  }

  const keys = Object.keys(row.rawData);

  return (
    <dialog
      ref={dialogRef}
      onClick={handleBackdropClick}
      onClose={onClose}
      className="m-auto w-[calc(100%-2rem)] max-w-xl rounded-xl bg-white p-0 shadow-2xl backdrop:bg-black/40 open:flex open:flex-col"
    >
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 font-heading">
            Edit row {row.rowIndex + 1}
          </h2>
          <p className="mt-0.5 text-xs text-slate-400 font-body">
            Changes will reset the row status to pending.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          aria-label="Close"
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40 transition-colors"
        >
          ✕
        </button>
      </div>

      {/* ── Form ──────────────────────────────────────────────────────────── */}
      <form onSubmit={handleSave} className="flex flex-col">
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {keys.length === 0 && (
            <p className="text-sm text-slate-400 font-body">
              No fields to edit.
            </p>
          )}
          <div className="space-y-3">
            {keys.map((key) => (
              <div key={key}>
                <label className="mb-1 block text-xs font-semibold text-slate-600 font-body">
                  {key}
                </label>
                <input
                  type="text"
                  value={fields[key] ?? ""}
                  onChange={(e) => handleChange(key, e.target.value)}
                  disabled={saving}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:opacity-60 font-body"
                />
              </div>
            ))}
          </div>
        </div>

        {/* ── Error banner ────────────────────────────────────────────────── */}
        {error && (
          <div className="mx-5 mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 font-body">
            {error}
          </div>
        )}

        {/* ── Footer actions ──────────────────────────────────────────────── */}
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors font-body"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || keys.length === 0}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 transition-colors font-body"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
