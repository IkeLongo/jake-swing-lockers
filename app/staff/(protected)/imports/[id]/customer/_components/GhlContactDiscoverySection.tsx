"use client";

import { useEffect, useRef, useState } from "react";
import {
  IconAlertTriangle,
  IconCheck,
  IconRefresh,
} from "@tabler/icons-react";
import type {
  ContactDiscovery,
  DiscoveredContact,
} from "@/lib/ghl/discoverStagedContacts";
import type { DiscoveryLocalCustomer } from "@/lib/ghl/discoverBatchContact";
import type { GhlApprovalView } from "@/lib/ghl/approveBatchContact";
import {
  candidateIndicators,
  candidateNeedsReview,
  discoveryNotices,
  type ComparableCustomer,
} from "@/lib/ghl/discoveryComparison";
import {
  candidateApprovalBlock,
  discrepancyLabel,
  isStaleApprovalCode,
  missingCandidateAcks,
  missingDiscrepancyAcks,
  newContactBlock,
} from "@/lib/ghl/approvalUi";

interface Props {
  batchId: number;
  initialApproval: GhlApprovalView | null;
  onApprovalChange: (approval: GhlApprovalView) => void;
}

interface Loaded {
  localCustomer: DiscoveryLocalCustomer;
  discovery: ContactDiscovery;
  discoverySignature: string;
}

type Result =
  | { kind: "idle" }
  | { kind: "loading"; previous: Loaded | null }
  | { kind: "unavailable"; message: string }
  | { kind: "error"; message: string }
  | ({ kind: "done" } & Loaded);

type BadgeTone = "neutral" | "match" | "review";

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  match: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  review: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

const secondaryButton =
  "rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 font-subheading";

function Badge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold font-subheading ${BADGE_TONE[tone]}`}
    >
      {children}
    </span>
  );
}

function displayName(c: ComparableCustomer, fallback: string): string {
  return [c.firstName, c.lastName].filter(Boolean).join(" ") || fallback;
}

function Details({ customer, fallbackName }: { customer: ComparableCustomer; fallbackName: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold text-foreground font-body">
        {displayName(customer, fallbackName)}
      </p>
      <p className="truncate text-sm text-muted-foreground font-body">
        {customer.email || "No email"}
      </p>
      <p className="truncate text-sm text-muted-foreground font-body">
        {customer.phone || "No phone"}
      </p>
    </div>
  );
}

function Indicators({ items }: { items: ReturnType<typeof candidateIndicators> }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1">
      {items.map((item) => (
        <li
          key={item.label}
          className={`flex items-start gap-1.5 text-xs font-body ${
            item.tone === "match"
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-amber-700 dark:text-amber-400"
          }`}
        >
          {item.tone === "match" ? (
            <IconCheck className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          ) : (
            <IconAlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          )}
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

function AckCheckbox({
  checked,
  onChange,
  disabled,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-xs text-foreground font-body">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
      />
      <span>{children}</span>
    </label>
  );
}

function toggle(list: string[], value: string, on: boolean): string[] {
  const rest = list.filter((v) => v !== value);
  return on ? [...rest, value] : rest;
}

function Candidate({
  candidate,
  discovery,
  local,
  approved,
  approvalBlocked,
  busy,
  onApprove,
}: {
  candidate: DiscoveredContact;
  discovery: ContactDiscovery;
  local: ComparableCustomer;
  approved: boolean;
  approvalBlocked: boolean;
  busy: boolean;
  onApprove: (acknowledged: string[]) => void;
}) {
  const [acked, setAcked] = useState<string[]>([]);
  const needsReview = candidateNeedsReview(discovery, candidate);
  const block = candidateApprovalBlock(discovery, candidate);
  const missing = missingDiscrepancyAcks(candidate, acked);
  return (
    <div className="px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground font-subheading">
          GHL contact
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {approved && <Badge tone="match">Approved</Badge>}
          {candidate.reasons.includes("saved_link") && <Badge tone="match">Saved link</Badge>}
          {needsReview ? (
            <Badge tone="review">Needs review</Badge>
          ) : (
            <Badge tone="match">Match</Badge>
          )}
        </div>
      </div>
      <div className="mt-2">
        <Details customer={candidate} fallbackName="Unnamed contact" />
      </div>
      <Indicators items={candidateIndicators(local, candidate)} />

      {!approved && (
        <div className="mt-3 space-y-2">
          {block ? (
            <p className="text-xs text-muted-foreground font-body">
              Cannot be approved: {block}
            </p>
          ) : (
            <>
              {candidate.discrepancies.length > 0 && (
                <div className="space-y-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
                  <p className="text-xs font-semibold text-foreground font-subheading">
                    Acknowledge the differences to continue
                  </p>
                  {candidate.discrepancies.map((kind) => (
                    <AckCheckbox
                      key={kind}
                      checked={acked.includes(kind)}
                      disabled={busy || approvalBlocked}
                      onChange={(on) => setAcked((cur) => toggle(cur, kind, on))}
                    >
                      {discrepancyLabel(kind)}; this is the same person
                    </AckCheckbox>
                  ))}
                </div>
              )}
              <button
                type="button"
                disabled={busy || approvalBlocked || missing.length > 0}
                onClick={() => onApprove(acked)}
                className={secondaryButton}
              >
                Use this GHL contact
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function emptyMessage(d: ContactDiscovery): string | null {
  if (d.candidates.length > 0) return null;
  if (d.status === "no_identifier") {
    return "No email or phone that can be searched in GHL.";
  }
  if (d.status === "no_match") {
    return "No matching GHL contact found.";
  }
  return null;
}

function savedLinkBlockedMessage(d: ContactDiscovery): string | null {
  if (!d.savedLink.id) return null;
  switch (d.savedLink.status) {
    case "missing":
      return "Saved GHL contact was not found in GHL, so it cannot be approved. Reassigning is not supported.";
    case "wrong_location":
      return "Saved GHL contact belongs to a different GHL location, so it cannot be approved.";
    case "unverified_location":
      return "GHL could not confirm the saved contact's location, so it cannot be approved.";
    default:
      return null;
  }
}

function ApprovalBanner({
  approval,
  confirmedInLookup,
  busy,
  onClear,
}: {
  approval: GhlApprovalView;
  confirmedInLookup: boolean | null;
  busy: boolean;
  onClear: () => void;
}) {
  if (approval.status === "stale") {
    return (
      <div className="flex items-start gap-2 border-t border-border/60 px-4 py-3 text-xs text-amber-700 dark:text-amber-400 sm:px-6 font-body">
        <IconAlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
        <p>The customer changed after the GHL contact was approved. Review and approve again.</p>
      </div>
    );
  }
  if (!approval.current) return null;
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-t border-border/60 px-4 py-3 sm:px-6">
      <div className="min-w-0 space-y-0.5">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground font-body">
          <IconCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
          {approval.decision === "existing"
            ? "Existing GHL contact approved"
            : "New GHL contact approved"}
        </p>
        <p className="text-xs text-muted-foreground font-body">
          {approval.decision === "new"
            ? "A contact will be created when the CRM sync runs. Nothing is created now."
            : "Saved on this fitting."}{" "}
          {confirmedInLookup === null
            ? "Look up again to re-check GHL."
            : confirmedInLookup
              ? "Confirmed in the latest lookup."
              : "Not confirmed by the latest lookup."}
        </p>
      </div>
      <button type="button" disabled={busy} onClick={onClear} className={secondaryButton}>
        Clear decision
      </button>
    </div>
  );
}

export function GhlContactDiscoverySection({
  batchId,
  initialApproval,
  onApprovalChange,
}: Props) {
  const [result, setResult] = useState<Result>({ kind: "idle" });
  const [approval, setApproval] = useState<GhlApprovalView | null>(initialApproval);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [newAcked, setNewAcked] = useState<string[]>([]);
  const loading = result.kind === "loading";
  const base = `/api/staff/imports/${batchId}`;
  const onChangeRef = useRef(onApprovalChange);
  useEffect(() => {
    onChangeRef.current = onApprovalChange;
  });

  function updateApproval(next: GhlApprovalView) {
    setApproval(next);
    onChangeRef.current(next);
  }

  useEffect(() => {
    if (initialApproval) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${base}/ghl-contact-approval`, {
          cache: "no-store",
        });
        const data = (await response.json()) as { approval?: GhlApprovalView };
        if (!cancelled && response.ok && data.approval) {
          setApproval(data.approval);
          onChangeRef.current(data.approval);
        }
      } catch {
        // Continue stays disabled until the approval state can be read.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, initialApproval]);

  async function lookUp() {
    if (loading) return;
    setResult((current) => ({
      kind: "loading",
      previous: current.kind === "done" ? current : null,
    }));
    try {
      const response = await fetch(`${base}/ghl-contact-discovery`, {
        cache: "no-store",
      });
      const data = (await response.json()) as
        | ({ success: true } & Loaded)
        | { error: string; code?: string };
      if ("success" in data && response.ok) {
        setResult({
          kind: "done",
          localCustomer: data.localCustomer,
          discovery: data.discovery,
          discoverySignature: data.discoverySignature,
        });
        return;
      }
      const message = "error" in data ? data.error : "Could not look up GHL contacts.";
      setResult(
        "code" in data && data.code === "ghl_unavailable"
          ? { kind: "unavailable", message }
          : { kind: "error", message },
      );
    } catch {
      setResult({
        kind: "unavailable",
        message: "Could not reach the server to check GHL contacts.",
      });
    }
  }

  async function submit(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const response = await fetch(`${base}/ghl-contact-approval`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as
        | { success: true; approval: GhlApprovalView }
        | { error: string; code?: string };
      if (response.ok && "success" in data) {
        updateApproval(data.approval);
        setNewAcked([]);
        return;
      }
      const code = "code" in data ? data.code : undefined;
      const message = "error" in data ? data.error : "Could not save the decision.";
      if (isStaleApprovalCode(code)) {
        setActionError(`${message} The lookup was refreshed.`);
        await lookUp();
        return;
      }
      setActionError(message);
    } catch {
      setActionError("Network error while saving. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const loaded: Loaded | null =
    result.kind === "done"
      ? result
      : result.kind === "loading"
        ? result.previous
        : null;
  const discovery = loaded?.discovery ?? null;
  const local = loaded?.localCustomer ?? null;
  const signature = loaded?.discoverySignature ?? null;
  const notices = discovery ? discoveryNotices(discovery) : [];
  const empty = discovery ? emptyMessage(discovery) : null;
  const savedBlocked = discovery ? savedLinkBlockedMessage(discovery) : null;
  const approvedExisting =
    approval?.current && approval.decision === "existing"
      ? approval.approvedContactId
      : null;
  const approvedNew = approval?.current === true && approval.decision === "new";
  const newBlock = discovery ? newContactBlock(discovery) : null;
  const confirmedInLookup = !discovery
    ? null
    : approvedExisting
      ? discovery.candidates.some(
          (c) => c.id === approvedExisting && c.locationVerified && !c.wrongLocation,
        )
      : approval?.decision === "new"
        ? newBlock === null || discovery.candidates.length > 0
        : null;
  const controlsDisabled = busy || loading || !signature;
  const missingNewAcks = discovery ? missingCandidateAcks(discovery, newAcked) : [];

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground font-subheading">
            GHL contact
          </h2>
          <p className="text-xs text-muted-foreground font-body">
            Look up and approve the contact for this fitting. Nothing is changed in GHL.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void lookUp()}
          disabled={loading || busy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 font-subheading"
        >
          <IconRefresh className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Looking up…" : result.kind === "idle" ? "Look up in GHL" : "Refresh"}
        </button>
      </div>

      {approval && (
        <ApprovalBanner
          approval={approval}
          confirmedInLookup={confirmedInLookup}
          busy={busy}
          onClear={() => void submit({ action: "clear" })}
        />
      )}

      {actionError && (
        <p className="flex items-start gap-2 border-t border-border/60 px-4 py-3 text-sm text-foreground sm:px-6 font-body">
          <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <span>{actionError}</span>
        </p>
      )}

      {(result.kind === "unavailable" || result.kind === "error") && (
        <div className="flex items-start gap-2 border-t border-border/60 px-4 py-4 text-sm text-amber-700 dark:text-amber-400 sm:px-6 font-body">
          <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            {result.kind === "unavailable" ? "GHL lookup unavailable. " : ""}
            {result.message} This is not a &quot;no match&quot; result.
          </p>
        </div>
      )}

      {discovery && local && (
        <div className="divide-y divide-border/60 border-t border-border/60">
          <div className="px-4 py-4 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground font-subheading">
                Local customer
              </p>
              <Badge tone="neutral">Selected</Badge>
            </div>
            <div className="mt-2">
              <Details customer={local} fallbackName="Unnamed customer" />
            </div>
          </div>

          {(notices.length > 0 || empty || savedBlocked) && (
            <div className="space-y-1 px-4 py-3 sm:px-6">
              {empty && (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground font-body">
                  {discovery.status === "no_match" && (
                    <IconCheck className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                  )}
                  <span>{empty}</span>
                </p>
              )}
              {notices.length > 0 && (
                <ul className="space-y-1">
                  {notices.map((notice) => (
                    <li
                      key={notice}
                      className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400 font-body"
                    >
                      <IconAlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span>{notice}</span>
                    </li>
                  ))}
                </ul>
              )}
              {savedBlocked && (
                <p className="text-xs text-foreground font-body">{savedBlocked}</p>
              )}
            </div>
          )}

          {discovery.candidates.map((candidate) => (
            <Candidate
              key={`${signature}:${candidate.id}`}
              candidate={candidate}
              discovery={discovery}
              local={local}
              approved={approvedExisting === candidate.id}
              approvalBlocked={controlsDisabled}
              busy={busy}
              onApprove={(acknowledged) =>
                void submit({
                  action: "approve_existing",
                  contactId: candidate.id,
                  discoverySignature: signature,
                  acknowledgedDiscrepancies: acknowledged,
                })
              }
            />
          ))}

          <div className="px-4 py-4 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground font-subheading">
                New GHL contact
              </p>
              {approvedNew && <Badge tone="match">Approved</Badge>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground font-body">
              Approves creating a contact when the CRM sync runs. Nothing is created now.
            </p>
            {!approvedNew && (
              <div className="mt-3 space-y-2">
                {newBlock ? (
                  <p className="text-xs text-muted-foreground font-body">
                    Unavailable: {newBlock}
                  </p>
                ) : (
                  discovery.candidates.length > 0 && (
                    <div className="space-y-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
                      <p className="text-xs font-semibold text-foreground font-subheading">
                        Confirm each match is a different person
                      </p>
                      {discovery.candidates.map((candidate) => (
                        <AckCheckbox
                          key={candidate.id}
                          checked={newAcked.includes(candidate.id)}
                          disabled={controlsDisabled}
                          onChange={(on) =>
                            setNewAcked((cur) => toggle(cur, candidate.id, on))
                          }
                        >
                          {displayName(candidate, "Unnamed contact")}
                          {candidate.email ? ` (${candidate.email})` : ""} is a different person
                        </AckCheckbox>
                      ))}
                    </div>
                  )
                )}
                <button
                  type="button"
                  disabled={controlsDisabled || newBlock !== null || missingNewAcks.length > 0}
                  onClick={() =>
                    void submit({
                      action: "approve_new",
                      discoverySignature: signature,
                      acknowledgedCandidateIds: newAcked,
                    })
                  }
                  className={secondaryButton}
                >
                  Create new GHL contact
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
