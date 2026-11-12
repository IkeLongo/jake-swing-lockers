"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconArrowLeft } from "@tabler/icons-react";
import {
  finalizeAndSync,
  runCrmSync,
  type ConfirmPhase,
} from "@/lib/imports/confirm-flow";
import type { ConfirmStage } from "@/lib/imports/confirm-page";
import { isContactApprovalRecoveryError } from "@/lib/ghl/syncErrorMarker";
import { ContactRecovery } from "./ContactRecovery";

interface Props {
  batchId: number;
  initialStage: ConfirmStage;
  syncAttempted: boolean;
  initialError: string | null;
}

const primaryButton =
  "rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 font-subheading";
const linkClass =
  "inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground font-subheading";

function initialPhase(stage: ConfirmStage, error: string | null): ConfirmPhase | null {
  if (stage === "synced") return { kind: "synced" };
  if (stage === "crm_pending") return { kind: "crm_pending", error };
  if (stage === "crm_action_required") {
    return {
      kind: "crm_action_required",
      error: error ?? "The CRM sync needs attention.",
    };
  }
  return null;
}

export function ConfirmActions({ batchId, initialStage, syncAttempted, initialError }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<ConfirmPhase | null>(() =>
    initialPhase(initialStage, initialError),
  );
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(syncAttempted);
  const inFlight = useRef(false);

  async function run(action: () => Promise<ConfirmPhase>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const next = await action();
      setPhase(next);
      if (next.kind !== "finalize_failed") {
        setAttempted(true);
        // Re-render the server summary (e.g. the created opportunity).
        router.refresh();
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const viewFitting = (
    <Link href={`/staff/imports/${batchId}/map`} className={primaryButton}>
      View Fitting →
    </Link>
  );
  const backToImports = (
    <Link href="/staff/imports" className={linkClass}>
      <IconArrowLeft className="h-4 w-4" />
      Back to Imports
    </Link>
  );

  if (phase?.kind === "synced") {
    return (
      <div className="border-t border-border pt-4">
        <p className="text-base font-semibold text-foreground font-heading">
          Fitting Finalized
        </p>
        <p className="mt-1 text-sm text-muted-foreground font-body">
          The fitting was saved and synced successfully.
        </p>
        <div className="mt-3 flex items-center justify-between gap-3">
          {backToImports}
          {viewFitting}
        </div>
      </div>
    );
  }

  if (phase?.kind === "crm_pending") {
    return (
      <div className="border-t border-border pt-4">
        <p className="text-base font-semibold text-foreground font-heading">
          Fitting Saved
          <span className="ml-2 text-sm font-medium text-muted-foreground font-subheading">
            CRM Sync Pending
          </span>
        </p>
        <p className="mt-1 text-sm text-muted-foreground font-body">
          {attempted
            ? "The fitting was finalized successfully, but the CRM sync could not be completed."
            : "The fitting was finalized successfully. The CRM sync has not completed yet."}
        </p>
        {phase.error && (
          <p className="mt-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-foreground font-body">
            {phase.error}
          </p>
        )}
        <div className="mt-3 flex items-center justify-between gap-3">
          {backToImports}
          <div className="flex items-center gap-2">
            <Link
              href={`/staff/imports/${batchId}/map`}
              className="rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted font-subheading"
            >
              View Fitting
            </Link>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => runCrmSync(fetch, batchId))}
              className={primaryButton}
            >
              {busy ? "Syncing…" : attempted ? "Retry CRM Sync" : "Sync to CRM"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase?.kind === "crm_action_required") {
    return (
      <div className="border-t border-border pt-4">
        <p className="text-base font-semibold text-foreground font-heading">
          Fitting Saved
          <span className="ml-2 text-sm font-medium text-muted-foreground font-subheading">
            CRM Action Required
          </span>
        </p>
        <p className="mt-1 text-sm text-muted-foreground font-body">
          The fitting was finalized successfully, but the CRM sync needs
          attention and could not be completed. Resolve the issue below before retrying.
        </p>
        <p className="mt-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-foreground font-body">
          {phase.error}
        </p>
        {isContactApprovalRecoveryError(phase.error) && (
          <ContactRecovery
            batchId={batchId}
            onRecovered={() => {
              setPhase({ kind: "crm_pending", error: "Contact approval updated. Retry CRM sync." });
              router.refresh();
            }}
          />
        )}
        <div className="mt-3 flex items-center justify-between gap-3">
          {backToImports}
          {viewFitting}
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-border pt-3">
      {phase?.kind === "finalize_failed" && (
        <p
          role="alert"
          className="mb-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-foreground font-body"
        >
          {phase.error}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/staff/imports/${batchId}/opportunity`}
          aria-disabled={busy}
          className={linkClass}
        >
          <IconArrowLeft className="h-4 w-4" />
          Back to Opportunity
        </Link>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => finalizeAndSync(fetch, batchId))}
          className={primaryButton}
        >
          {busy ? "Finalizing…" : "Finalize Fitting"}
        </button>
      </div>
    </div>
  );
}
