"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { ClientPicker } from "@/app/staff/_components/ClientPicker";
import type { ClientPickerValue } from "@/app/staff/_components/ClientPicker";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SessionEditData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** ISO date string */
  demoDate: string;
  notes: string;
}

type ClientAssignment = "keep" | "change";

interface Props {
  sessionId: number;
  initial: SessionEditData;
  onClose: () => void;
  onSaved: (updated: SessionEditData) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EditDemoSessionModal({
  sessionId,
  initial,
  onClose,
  onSaved,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);

  const toDateInput = (iso: string) => {
    try {
      return new Date(iso).toISOString().slice(0, 10);
    } catch {
      return "";
    }
  };

  // ── State ──────────────────────────────────────────────────────────────────
  const [clientAssignment, setClientAssignment] =
    useState<ClientAssignment>("keep");
  const [clientPickerValue, setClientPickerValue] =
    useState<ClientPickerValue | null>(null);

  const [demoDate, setDemoDate] = useState(toDateInput(initial.demoDate));
  const [notes, setNotes] = useState(initial.notes);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentClientName =
    [initial.firstName, initial.lastName].filter(Boolean).join(" ") ||
    initial.email ||
    "Unknown Client";

  // ── ESC key / scroll lock ──────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    if (loading) return;
    onClose();
  }, [loading, onClose]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleClose]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!demoDate) {
      setError("Demo date is required.");
      return;
    }

    if (clientAssignment === "change") {
      if (!clientPickerValue) {
        setError(
          "Please select or create a client, or choose to keep the current client.",
        );
        return;
      }
      if (clientPickerValue.mode === "new") {
        if (!clientPickerValue.firstName.trim()) {
          setError("First name is required.");
          return;
        }
        if (!clientPickerValue.lastName.trim()) {
          setError("Last name is required.");
          return;
        }
        if (
          !clientPickerValue.email.trim() &&
          !clientPickerValue.phone.trim()
        ) {
          setError("At least one of email or phone is required.");
          return;
        }
      }
    }

    setLoading(true);

    type PatchBody = {
      demoDate: string;
      notes: string;
      existingGolfClientId?: number;
      newClient?: {
        firstName: string;
        lastName: string;
        email: string;
        phone: string;
      };
    };

    const body: PatchBody = {
      demoDate: new Date(demoDate).toISOString(),
      notes: notes.trim(),
    };

    if (clientAssignment === "change" && clientPickerValue) {
      if (clientPickerValue.mode === "existing") {
        body.existingGolfClientId = clientPickerValue.clientId;
      } else {
        body.newClient = {
          firstName: clientPickerValue.firstName,
          lastName: clientPickerValue.lastName,
          email: clientPickerValue.email,
          phone: clientPickerValue.phone,
        };
      }
    }

    try {
      const res = await fetch(`/api/staff/demo-sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }

      const data = (await res.json()) as {
        success: boolean;
        firstName: string;
        lastName: string;
        email: string;
        phone: string;
        demoDate: string;
        notes: string | null;
      };

      onSaved({
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        demoDate: data.demoDate,
        notes: data.notes ?? "",
      });
    } catch {
      setError("Network error. Please check your connection and try again.");
      setLoading(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      aria-modal="true"
      role="dialog"
      aria-labelledby="edit-session-modal-title"
      onClick={(e) => {
        if (e.target === overlayRef.current) handleClose();
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Panel */}
      <div className="relative z-10 flex max-h-[90dvh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl ring-1 ring-slate-200">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-5">
          <h2
            id="edit-session-modal-title"
            className="text-base font-semibold text-slate-900 font-heading"
          >
            Edit Demo Session
          </h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors disabled:opacity-50"
            aria-label="Close"
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {/* ── Client section ──────────────────────────────────────────── */}
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400 font-subheading">
                Client
              </p>

              {/* Current client display */}
              <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="mb-1 text-xs font-semibold text-slate-500 font-subheading">
                  Current client
                </p>
                <p className="text-sm font-semibold text-slate-800 font-body">
                  {currentClientName}
                </p>
                {initial.email && (
                  <p className="text-xs text-slate-400 font-body">
                    {initial.email}
                  </p>
                )}
                {initial.phone && (
                  <p className="text-xs text-slate-400 font-body">
                    {initial.phone}
                  </p>
                )}
              </div>

              {/* Keep / Change toggle */}
              <div className="mb-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setClientAssignment("keep");
                    setClientPickerValue(null);
                    setError(null);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors font-subheading ${
                    clientAssignment === "keep"
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  Keep current
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setClientAssignment("change");
                    setClientPickerValue(null);
                    setError(null);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors font-subheading ${
                    clientAssignment === "change"
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  Change client
                </button>
              </div>

              {clientAssignment === "keep" ? (
                <p className="text-xs text-slate-400 font-body">
                  The session will remain assigned to the current client.
                </p>
              ) : (
                <ClientPicker
                  onChange={setClientPickerValue}
                  disabled={loading}
                />
              )}
            </div>

            {/* ── Session details ─────────────────────────────────────────── */}
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400 font-subheading">
                Session Details
              </p>
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700 font-body">
                  Demo date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={demoDate}
                  onChange={(e) => {
                    setDemoDate(e.target.value);
                    setError(null);
                  }}
                  disabled={loading}
                  required
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-xs outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50 font-body"
                />
              </div>
              <div className="mt-3">
                <label className="mb-1 block text-sm font-semibold text-slate-700 font-body">
                  Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={loading}
                  rows={3}
                  placeholder="Fitting at demo day event…"
                  className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-xs outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50 font-body"
                />
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600 font-body">{error}</p>
            )}
          </div>

          {/* Footer */}
          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-100 px-6 py-4">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition-colors disabled:opacity-50 font-body"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 transition-colors disabled:opacity-50 font-body"
            >
              {loading ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
