"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClientPicker } from "@/app/staff/_components/ClientPicker";
import type { ClientPickerValue } from "@/app/staff/_components/ClientPicker";

export function CreateSessionForm() {
  const router = useRouter();

  // ── Client ─────────────────────────────────────────────────────────────────
  const [clientValue, setClientValue] = useState<ClientPickerValue | null>(null);

  // ── Session fields ─────────────────────────────────────────────────────────
  const [demoDate, setDemoDate] = useState(
    new Date().toISOString().slice(0, 10), // default today
  );
  const [notes, setNotes] = useState("");

  // ── Submission ─────────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    const body: Record<string, unknown> = {
      demoDate,
      notes: notes || undefined,
    };

    if (!clientValue) {
      setSubmitError("Please select an existing client or switch to create a new one.");
      return;
    }
    if (clientValue.mode === "existing") {
      body.existingGolfClientId = clientValue.clientId;
    } else {
      body.firstName = clientValue.firstName;
      body.lastName = clientValue.lastName;
      body.email = clientValue.email;
      body.phone = clientValue.phone;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/staff/demo-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as
        | { success: true; demoSessionId: number }
        | { error: string };

      if (!res.ok || !("success" in data)) {
        setSubmitError("error" in data ? data.error : "Unexpected error.");
        return;
      }

      router.push(`/staff/demo-sessions/${data.demoSessionId}/upload`);
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-slate-200 bg-white shadow-xs"
    >
      {/* Header */}
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-base font-semibold text-slate-800 font-heading">
          Client
        </h2>
        <p className="mt-0.5 text-xs text-slate-500 font-body">
          Find an existing client or create a new one.
        </p>
      </div>

      <div className="px-5 py-5 space-y-5">
        {/* Client picker */}
        <ClientPicker onChange={setClientValue} disabled={submitting} />

        {/* Divider */}
        <div className="border-t border-slate-100 pt-1">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400 font-subheading">
            Session Details
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-600 font-subheading">
                Demo date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                required
                value={demoDate}
                onChange={(e) => setDemoDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-slate-400 focus:outline-none font-body"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-600 font-subheading">
                Notes
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional session notes…"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none font-body"
              />
            </div>
          </div>
        </div>

        {/* Error */}
        {submitError && (
          <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 font-body">
            {submitError}
          </p>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50 font-subheading"
        >
          {submitting ? "Creating session…" : "Create Demo Session →"}
        </button>
      </div>
    </form>
  );
}
