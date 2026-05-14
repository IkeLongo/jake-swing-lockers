"use client";

import { useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ModalClub {
  id: number;
  clubType: string | null;
  brand: string | null;
  model: string | null;
  estimatedPrice: number | null;
}

interface PurchaseRequestTriggerProps {
  sessionId: number;
  clubs: ModalClub[];
}

type Step = "idle" | "open" | "submitting" | "success" | "error";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPrice(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function clubLabel(club: ModalClub): string {
  const parts = [club.clubType, club.brand, club.model].filter(Boolean);
  return parts.length > 0 ? parts.join(" — ") : "Club";
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PurchaseRequestTrigger({ sessionId, clubs }: PurchaseRequestTriggerProps) {
  const [step, setStep] = useState<Step>("idle");
  const [checkedIds, setCheckedIds] = useState<Set<number>>(
    new Set(clubs.map((c) => c.id))
  );
  const [notes, setNotes] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  function toggleClub(id: number) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function openModal() {
    // Reset state each time modal opens
    setCheckedIds(new Set(clubs.map((c) => c.id)));
    setNotes("");
    setErrorMsg("");
    setStep("open");
  }

  function closeModal() {
    setStep("idle");
  }

  async function handleSubmit() {
    if (checkedIds.size === 0) return;
    setStep("submitting");
    setErrorMsg("");

    try {
      const res = await fetch("/api/swing-locker/purchase-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          demoSessionId: sessionId,
          clubIds: Array.from(checkedIds),
          notes: notes.trim() || undefined,
        }),
      });

      if (res.status === 201) {
        setStep("success");
      } else if (res.status === 409) {
        // Already submitted — treat as success
        setStep("success");
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMsg(data.error ?? "Something went wrong. Please try again.");
        setStep("error");
      }
    } catch {
      setErrorMsg("Network error. Please check your connection and try again.");
      setStep("error");
    }
  }

  // ── Trigger button ──────────────────────────────────────────────────────────

  if (step === "idle") {
    return (
      <div className="mt-6">
        <button
          onClick={openModal}
          className="w-full rounded-xl bg-emerald-600 px-5 py-3.5 font-body text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 active:bg-emerald-800 transition-colors"
        >
          Request Purchase
        </button>
      </div>
    );
  }

  // ── Modal backdrop + card ───────────────────────────────────────────────────

  return (
    <>
      {/* Trigger placeholder — keeps layout stable */}
      <div className="mt-6">
        <button
          disabled
          className="w-full rounded-xl bg-emerald-600 px-5 py-3.5 font-body text-sm font-semibold text-white shadow-sm opacity-50 cursor-default"
        >
          Request Purchase
        </button>
      </div>

      {/* Modal overlay */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
        onClick={(e) => {
          if (e.target === e.currentTarget && step !== "submitting") closeModal();
        }}
      >
        <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-xl flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <h2 className="font-heading text-base font-semibold text-slate-900">
              {step === "success" ? "Request Submitted" : "Request Purchase"}
            </h2>
            {step !== "submitting" && (
              <button
                onClick={closeModal}
                className="text-slate-400 hover:text-slate-600 transition-colors text-lg leading-none"
                aria-label="Close"
              >
                ✕
              </button>
            )}
          </div>

          {/* Body */}
          <div className="overflow-y-auto px-6 py-5 flex-1">
            {step === "success" ? (
              // ── Success state ─────────────────────────────────────────────
              <div className="text-center py-6">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-500">
                  <span className="text-2xl">✓</span>
                </div>
                <p className="font-subheading text-base font-semibold text-slate-900 mb-2">
                  Your request has been submitted!
                </p>
                <p className="font-body text-sm text-slate-500 leading-relaxed">
                  A member of our team will be in touch with you soon to discuss your
                  selections.
                </p>
              </div>
            ) : (
              // ── Selection state ───────────────────────────────────────────
              <>
                <p className="font-body text-sm text-slate-500 mb-4 leading-relaxed">
                  Select the clubs you&apos;re interested in purchasing. Our team will
                  follow up with pricing and availability.
                </p>

                {/* Club list */}
                <div className="flex flex-col gap-2 mb-5">
                  {clubs.map((club) => (
                    <label
                      key={club.id}
                      className={`flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-colors ${
                        checkedIds.has(club.id)
                          ? "border-emerald-300 bg-emerald-50"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checkedIds.has(club.id)}
                        onChange={() => toggleClub(club.id)}
                        disabled={step === "submitting"}
                        className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="flex-1 font-body text-sm text-slate-800 leading-snug">
                        {clubLabel(club)}
                      </span>
                      {club.estimatedPrice != null && (
                        <span className="font-body text-sm font-semibold text-emerald-700 shrink-0">
                          {fmtPrice(club.estimatedPrice)}
                        </span>
                      )}
                    </label>
                  ))}
                </div>

                {/* Notes */}
                <div>
                  <label className="block font-body text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                    Notes (optional)
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    disabled={step === "submitting"}
                    rows={3}
                    placeholder="Any questions or notes for our team?"
                    className="w-full rounded-xl border border-slate-200 px-4 py-2.5 font-body text-sm text-slate-800 placeholder-slate-400 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 focus:outline-none resize-none disabled:opacity-50"
                  />
                </div>

                {/* Error message */}
                {step === "error" && errorMsg && (
                  <p className="mt-3 font-body text-sm text-red-600">{errorMsg}</p>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-slate-100">
            {step === "success" ? (
              <button
                onClick={closeModal}
                className="w-full rounded-xl bg-slate-900 px-5 py-3 font-body text-sm font-semibold text-white hover:bg-slate-700 transition-colors"
              >
                Close
              </button>
            ) : (
              <div className="flex gap-3">
                <button
                  onClick={closeModal}
                  disabled={step === "submitting"}
                  className="flex-1 rounded-xl border border-slate-200 px-4 py-3 font-body text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={checkedIds.size === 0 || step === "submitting"}
                  className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 font-body text-sm font-semibold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {step === "submitting" ? "Submitting…" : "Submit Request"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
