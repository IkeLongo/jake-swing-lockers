"use client";

import { useState } from "react";

interface Review {
  fingerprint: string;
  previousDecision: string;
  previousContactId: string | null;
  contact: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    discrepancies: string[];
  };
}

export function ContactRecovery({ batchId, onRecovered }: {
  batchId: number;
  onRecovered: () => void;
}) {
  const [review, setReview] = useState<Review | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/staff/imports/${batchId}/contact-recovery`;

  async function load() {
    setBusy(true);
    setError(null);
    setReview(null);
    setConfirmed(false);
    try {
      const response = await fetch(url, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to review the contact.");
      setReview(data as Review);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to review the contact.");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!review || !confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true, fingerprint: review.fingerprint }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update the contact approval.");
      onRecovered();
    } catch (err) {
      setReview(null);
      setConfirmed(false);
      setError(err instanceof Error ? err.message : "Unable to update the contact approval.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-border bg-card p-4 text-sm font-body">
      <p>The fitting&apos;s contact approval is outdated. Review the customer&apos;s current contact before changing the fitting&apos;s decision.</p>
      {!review ? (
        <button type="button" disabled={busy} onClick={() => void load()} className="rounded-lg border border-border px-3 py-2 font-semibold disabled:opacity-50">
          {busy ? "Checking…" : "Review contact approval"}
        </button>
      ) : (
        <>
          <p>Previous approval: {review.previousDecision === "new" ? "Create a new contact" : `Contact ${review.previousContactId ?? "unavailable"}`}</p>
          <div>
            <p className="font-semibold">Current verified contact: {review.contact.id}</p>
            <p>{[review.contact.firstName, review.contact.lastName].filter(Boolean).join(" ") || "No name"}</p>
            <p>{review.contact.email || "No email"} · {review.contact.phone || "No phone"}</p>
            {review.contact.discrepancies.length > 0 && (
              <p>Differences from the local customer: {review.contact.discrepancies.join(", ")}.</p>
            )}
          </div>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy} />
            <span>I reviewed this contact and any differences. Change this fitting&apos;s approval to use it; do not create a new contact.</span>
          </label>
          <button type="button" disabled={!confirmed || busy} onClick={() => void approve()} className="rounded-lg bg-primary px-3 py-2 font-semibold text-primary-foreground disabled:opacity-50">
            {busy ? "Saving…" : "Approve contact for this fitting"}
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
