"use client";

import { useState } from "react";

const BADGE_STYLES: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  sent: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
};

const BADGE_LABELS: Record<string, string> = {
  pending: "Pending",
  sent: "Sent",
  failed: "Failed",
};

function buttonLabel(status: string | null): string {
  if (status === "pending" || status === "sent") return "Re-Send Access";
  if (status === "failed") return "Try Again";
  return "Send Access";
}

type Props = {
  sessionId: number;
  initialStatus: string | null;
  clientHasContact: boolean;
  /** "row" (default) = compact table cell; "card" = standalone card section */
  variant?: "row" | "card";
};

export default function SendAccessButton({
  sessionId,
  initialStatus,
  clientHasContact,
  variant = "row",
}: Props) {
  const [status, setStatus] = useState<string | null>(initialStatus);
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleClick() {
    setSubmitting(true);
    setSuccessMsg(null);
    setErrorMsg(null);

    try {
      const res = await fetch(`/api/staff/demo-sessions/${sessionId}/send-access`, {
        method: "POST",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMsg((body as { error?: string }).error ?? "Something went wrong.");
        return;
      }

      setStatus("pending");
      setSuccessMsg("Swing Locker access marked for sending.");
    } catch {
      setErrorMsg("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const badge = status ? (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${BADGE_STYLES[status] ?? "bg-slate-100 text-slate-500"}`}
    >
      {BADGE_LABELS[status] ?? status}
    </span>
  ) : null;

  // card variant — used on the session review page
  if (variant === "card") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          {badge ?? (
            <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Not Sent
            </span>
          )}
          {clientHasContact ? (
            <button
              onClick={handleClick}
              disabled={submitting}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Sending…" : buttonLabel(status)}
            </button>
          ) : (
            <p className="text-sm text-slate-400">
              Add an email or phone number before sending access.
            </p>
          )}
        </div>
        {successMsg && <p className="text-sm text-emerald-600">{successMsg}</p>}
        {errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {badge}
        {clientHasContact ? (
          <button
            onClick={handleClick}
            disabled={submitting}
            className="whitespace-nowrap text-sm font-medium text-emerald-700 hover:text-emerald-800 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Sending…" : buttonLabel(status)}
          </button>
        ) : (
          <span
            title="Client needs email or phone before access can be sent."
            className="cursor-default whitespace-nowrap text-sm font-medium text-slate-300"
          >
            Send Access
          </span>
        )}
      </div>
      {successMsg && (
        <p className="text-xs text-emerald-600">{successMsg}</p>
      )}
      {errorMsg && (
        <p className="text-xs text-red-600">{errorMsg}</p>
      )}
    </div>
  );
}
