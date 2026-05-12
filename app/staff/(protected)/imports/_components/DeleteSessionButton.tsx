"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  sessionId: number;
  clientName: string;
  /** Pre-formatted date string, e.g. "May 11, 2026" */
  demoDate: string;
  status: string;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  uploaded: "Uploaded",
  reviewing: "Reviewing",
  finalized: "Finalized",
  failed: "Failed",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function DeleteSessionButton({
  sessionId,
  clientName,
  demoDate,
  status,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const isFinalized = status === "finalized";
  const canConfirm = confirmInput === "DELETE" && !loading;

  // ── Open / close ────────────────────────────────────────────────────────────

  const openModal = () => {
    setConfirmInput("");
    setError(null);
    setOpen(true);
  };

  const closeModal = useCallback(() => {
    if (loading) return;
    setOpen(false);
    setConfirmInput("");
    setError(null);
  }, [loading]);

  // Auto-focus input when modal opens
  useEffect(() => {
    if (open) {
      // Defer to allow the modal to render first
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open]);

  // ESC key closes modal
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, closeModal]);

  // Prevent body scroll while open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // ── Delete handler ───────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!canConfirm) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/staff/demo-sessions/${sessionId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }

      // Success: close modal and refresh server component data
      setOpen(false);
      router.refresh();
    } catch {
      setError("Network error. Please check your connection and try again.");
      setLoading(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Trigger button */}
      <button
        type="button"
        onClick={openModal}
        aria-label="Delete session"
        className="flex items-center justify-center text-slate-300 hover:text-red-600 transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* Modal */}
      {open && (
        <div
          ref={overlayRef}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          aria-modal="true"
          role="dialog"
          aria-labelledby="delete-modal-title"
          // Click outside to close
          onClick={(e) => {
            if (e.target === overlayRef.current) closeModal();
          }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

          {/* Panel */}
          <div className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-xl ring-1 ring-slate-200">
            {/* Header */}
            <div className="flex items-start gap-3 border-b border-slate-100 px-6 py-5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100">
                <svg
                  className="h-5 w-5 text-red-600"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div>
                <h2
                  id="delete-modal-title"
                  className="text-base font-semibold text-slate-900 font-heading"
                >
                  Delete Demo Session?
                </h2>
                <p className="mt-1 text-sm text-slate-500 font-body">
                  You are about to permanently delete this demo session and all
                  associated staged import data.
                </p>
              </div>
            </div>

            {/* Session details */}
            <div className="px-6 py-5 space-y-3">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm font-body">
                <dt className="font-semibold text-slate-500">Golfer</dt>
                <dd className="text-slate-900">{clientName}</dd>
                <dt className="font-semibold text-slate-500">Demo Date</dt>
                <dd className="text-slate-900">{demoDate}</dd>
                <dt className="font-semibold text-slate-500">Status</dt>
                <dd>
                  <span
                    className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${
                      status === "finalized"
                        ? "bg-emerald-100 text-emerald-700"
                        : status === "reviewing"
                          ? "bg-yellow-100 text-yellow-700"
                          : status === "failed"
                            ? "bg-red-100 text-red-700"
                            : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {STATUS_LABEL[status] ?? status}
                  </span>
                </dd>
              </dl>

              {/* Extra warning for finalized sessions */}
              {isFinalized && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                  <p className="text-sm font-semibold text-red-700 font-body">
                    Warning: this session has been finalized.
                  </p>
                  <p className="mt-0.5 text-sm text-red-600 font-body">
                    Deleting it will also remove the Swing Locker club data.
                    This cannot be undone.
                  </p>
                </div>
              )}

              <p className="text-xs text-slate-400 font-body pt-1">
                This action cannot be undone. The golfer profile will be
                preserved.
              </p>

              {/* Typed confirmation */}
              <div className="pt-1">
                <label
                  htmlFor="delete-confirm-input"
                  className="block text-sm font-semibold text-slate-700 font-body mb-1.5"
                >
                  To confirm, type{" "}
                  <span className="font-mono text-red-600">DELETE</span>
                </label>
                <input
                  ref={inputRef}
                  id="delete-confirm-input"
                  type="text"
                  value={confirmInput}
                  onChange={(e) => {
                    setConfirmInput(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canConfirm) void handleDelete();
                  }}
                  disabled={loading}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="DELETE"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono text-slate-900 placeholder-slate-300 shadow-xs outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100 disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>

              {/* Error */}
              {error && (
                <p className="text-sm text-red-600 font-body">{error}</p>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4">
              <button
                type="button"
                onClick={closeModal}
                disabled={loading}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition-colors disabled:opacity-50 font-body"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={!canConfirm}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-red-700 transition-colors disabled:cursor-not-allowed disabled:opacity-40 font-body"
              >
                {loading ? "Deleting…" : "Delete Session"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
