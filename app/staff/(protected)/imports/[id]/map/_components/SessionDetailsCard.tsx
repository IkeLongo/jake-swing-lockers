"use client";

import { useState } from "react";
import EditDemoSessionModal, {
  type SessionEditData,
} from "./EditDemoSessionModal";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  sessionId: number;
  sessionStatus: string;
  initial: SessionEditData;
  /** ISO date string — the batch upload timestamp */
  uploadedAt?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SessionDetailsCard({
  sessionId,
  sessionStatus,
  initial,
  uploadedAt,
}: Props) {
  const [details, setDetails] = useState<SessionEditData>(initial);
  const [editOpen, setEditOpen] = useState(false);

  const isFinalized = sessionStatus === "finalized";

  const clientName =
    [details.firstName, details.lastName].filter(Boolean).join(" ") ||
    details.email ||
    "Unknown Client";

  const formattedDate = (() => {
    try {
      return new Date(details.demoDate).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
    } catch {
      return "—";
    }
  })();

  return (
    <>
      <div className="mb-4 flex items-start justify-between gap-4 rounded-xl border border-border bg-card px-5 py-3.5 shadow-xs">
        <div>
          <p className="text-base font-bold text-foreground font-heading">
            {clientName}
          </p>
          <p className="text-xs text-muted-foreground font-body">
            Demo Session — {formattedDate}
          </p>
          {uploadedAt && (
            <p className="text-xs text-muted-foreground font-body">
              Uploaded{" "}
              {new Date(uploadedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          )}
          {details.notes && (
            <p className="mt-1 text-xs text-muted-foreground font-body">
              Notes: {details.notes}
            </p>
          )}
        </div>

        <div className="shrink-0">
          {isFinalized ? (
            <p className="text-xs text-muted-foreground font-body">
              Finalized sessions cannot be edited.
            </p>
          ) : (
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-xs hover:bg-muted transition-colors font-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {editOpen && (
        <EditDemoSessionModal
          sessionId={sessionId}
          initial={details}
          onClose={() => setEditOpen(false)}
          onSaved={(updated) => {
            setDetails(updated);
            setEditOpen(false);
          }}
        />
      )}
    </>
  );
}
