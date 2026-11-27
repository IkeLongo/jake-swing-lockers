"use client";

import { useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ModalClub {
  id: number;
  label: string;
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
          className="w-full rounded-xl bg-primary px-5 py-3.5 font-body text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
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
          className="w-full rounded-xl bg-primary px-5 py-3.5 font-body text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Request Purchase
        </button>
      </div>

      {/* Modal overlay */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 px-4"
        onClick={(e) => {
          if (e.target === e.currentTarget && step !== "submitting") closeModal();
        }}
      >
        <div className="relative flex w-full max-w-lg max-h-[90vh] flex-col rounded-2xl border border-border bg-card text-card-foreground shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <h2 className="font-heading text-base font-semibold text-card-foreground">
              {step === "success" ? "Request Submitted" : "Request Purchase"}
            </h2>
            {step !== "submitting" && (
              <button
                onClick={closeModal}
                className="rounded-md text-lg leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                aria-label="Close"
              >
                ✕
              </button>
            )}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {step === "success" ? (
              // ── Success state ─────────────────────────────────────────────
              <div className="text-center py-6">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-primary">
                  <span className="text-2xl" aria-hidden="true">✓</span>
                </div>
                <p className="mb-2 font-subheading text-base font-semibold text-card-foreground">
                  Your request has been submitted!
                </p>
                <p className="font-body text-sm leading-relaxed text-muted-foreground">
                  A member of our team will be in touch with you soon to discuss your
                  selections.
                </p>
              </div>
            ) : (
              // ── Selection state ───────────────────────────────────────────
              <>
                <p className="mb-4 font-body text-sm leading-relaxed text-muted-foreground">
                  Select the clubs you&apos;re interested in purchasing. Our team will
                  follow up with pricing and availability.
                </p>

                {/* Club list */}
                <div className="mb-5 flex flex-col gap-2">
                  {clubs.map((club) => (
                    <label
                      key={club.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors focus-within:ring-2 focus-within:ring-primary/30 focus-within:ring-offset-2 focus-within:ring-offset-card ${
                        checkedIds.has(club.id)
                          ? "border-primary/30 bg-primary/5 dark:border-primary/40 dark:bg-primary/10"
                          : "border-border bg-card hover:border-primary/30 hover:bg-muted/30"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checkedIds.has(club.id)}
                        onChange={() => toggleClub(club.id)}
                        disabled={step === "submitting"}
                        className="h-4 w-4 rounded border-border accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      <span className="flex-1 font-body text-sm leading-snug text-card-foreground">
                        {club.label}
                      </span>
                      {club.estimatedPrice != null && (
                        <span className="shrink-0 font-body text-sm font-semibold text-card-foreground">
                          <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" aria-hidden="true" />
                          {fmtPrice(club.estimatedPrice)}
                        </span>
                      )}
                    </label>
                  ))}
                </div>

                {/* Notes */}
                <div>
                  <label className="mb-1.5 block font-body text-sm font-semibold text-foreground">
                    Notes (optional)
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    disabled={step === "submitting"}
                    rows={3}
                    placeholder="Any questions or notes for our team?"
                    className="w-full resize-none rounded-xl border border-border bg-card px-4 py-2.5 font-body text-sm text-card-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-muted disabled:opacity-50"
                  />
                </div>

                {/* Error message */}
                {step === "error" && errorMsg && (
                  <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 font-body text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400" role="alert">
                    {errorMsg}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-border px-6 py-4">
            {step === "success" ? (
              <button
                onClick={closeModal}
                className="w-full rounded-xl bg-primary px-5 py-3 font-body text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                Close
              </button>
            ) : (
              <div className="flex gap-3">
                <button
                  onClick={closeModal}
                  disabled={step === "submitting"}
                  className="flex-1 rounded-xl border border-border bg-card px-4 py-3 font-body text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={checkedIds.size === 0 || step === "submitting"}
                  aria-busy={step === "submitting"}
                  className="flex-1 rounded-xl bg-primary px-4 py-3 font-body text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
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
