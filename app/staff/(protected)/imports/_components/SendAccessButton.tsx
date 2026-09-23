"use client";

import { useState } from "react";

const BADGE_STYLES: Record<string, string> = {
  pending: "bg-accent/10 text-accent",
  sent: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  failed: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
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
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${BADGE_STYLES[status] ?? "bg-muted text-muted-foreground"}`}
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
            <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Not Sent
            </span>
          )}
          {clientHasContact ? (
            <button
              onClick={handleClick}
              disabled={submitting}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground shadow-xs hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {submitting ? "Sending…" : buttonLabel(status)}
            </button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Add an email or phone number before sending access.
            </p>
          )}
        </div>
        {successMsg && <p className="text-sm text-emerald-600 dark:text-emerald-400">{successMsg}</p>}
        {errorMsg && <p className="text-sm text-red-600 dark:text-red-400">{errorMsg}</p>}
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
            className="whitespace-nowrap text-sm font-medium text-primary hover:text-primary-hover hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Sending…" : buttonLabel(status)}
          </button>
        ) : (
          <span
            title="Client needs email or phone before access can be sent."
            className="cursor-default whitespace-nowrap text-sm font-medium text-muted-foreground/60"
          >
            Send Access
          </span>
        )}
      </div>
      {successMsg && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">{successMsg}</p>
      )}
      {errorMsg && (
        <p className="text-xs text-red-600 dark:text-red-400">{errorMsg}</p>
      )}
    </div>
  );
}
