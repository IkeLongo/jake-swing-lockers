"use client";

import { useState } from "react";
import { IconAlertTriangle, IconCheck } from "@tabler/icons-react";
import {
  ClubReviewGrid,
  type ShotReviewSummaryMetrics,
} from "./ClubReviewGrid";
import {
  EditClubSummaryModal,
  type SerializedClubSummary,
} from "./EditClubSummaryModal";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  batchId: number;
  initialSummaries: SerializedClubSummary[];
  parserMode?: string;
  /** ID of the linked DemoSession, if one exists. Required for finalization. */
  sessionId?: number;
  /** Current status of the linked DemoSession. */
  sessionStatus?: string;
  /** True when the session is finalized but club summaries have been edited since. */
  needsRefinalization?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ClubSummarySection({ batchId, initialSummaries, parserMode, sessionId, sessionStatus, needsRefinalization: initialNeedsRefinalization }: Props) {
  const [summaries, setSummaries] =
    useState<SerializedClubSummary[]>(initialSummaries);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  // IDs currently awaiting a PATCH toggle response
  const [toggling, setToggling] = useState<Set<number>>(new Set());
  const [toggleError, setToggleError] = useState<string | null>(null);
  // IDs currently awaiting a PATCH link response
  const [linking, setLinking] = useState<Set<number>>(new Set());
  const [linkError, setLinkError] = useState<string | null>(null);

  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [finalized, setFinalized] = useState(
    sessionStatus === "finalized",
  );
  // Tracks whether edits have been made since last finalization
  const [dirty, setDirty] = useState(initialNeedsRefinalization ?? false);

  const hasSummaries = summaries.length > 0;
  const editingSummary = summaries.find((s) => s.id === editingId) ?? null;
  const hasUnassigned = summaries.some((s) => s.clubName === "Unassigned");

  async function handleGenerate() {
    setGenerating(true);
    setGenerateError(null);

    try {
      const res = await fetch(
        `/api/staff/imports/${batchId}/generate-club-summaries`,
        { method: "POST" },
      );
      const json = (await res.json()) as {
        success?: boolean;
        summaries?: Record<string, unknown>[];
        error?: string;
      };

      if (!res.ok || !json.success) {
        setGenerateError(json.error ?? "Failed to generate summaries.");
        setGenerating(false);
        return;
      }

      // Normalize Decimal fields from the API response
      const toN = (v: unknown) =>
        v === null || v === undefined ? null : parseFloat(String(v));

      const normalized: SerializedClubSummary[] = (json.summaries ?? []).map(
        (s) => ({
          id: Number(s.id),
          importBatchId: Number(s.importBatchId),
          originalClubName: (s.originalClubName as string | null) ?? null,
          clubName: String(s.clubName),
          shotCount: Number(s.shotCount),
          avgClubSpeed: toN(s.avgClubSpeed),
          avgBallSpeed: toN(s.avgBallSpeed),
          avgSpinRate: toN(s.avgSpinRate),
          avgMaxHeight: toN(s.avgMaxHeight),
          avgCarry: toN(s.avgCarry),
          avgTotal: toN(s.avgTotal),
          validClubSpeedCount: Number(s.validClubSpeedCount),
          validBallSpeedCount: Number(s.validBallSpeedCount),
          validSpinRateCount: Number(s.validSpinRateCount),
          validMaxHeightCount: Number(s.validMaxHeightCount),
          validCarryCount: Number(s.validCarryCount),
          validTotalCount: Number(s.validTotalCount),
          isManuallyEdited: Boolean(s.isManuallyEdited),
          includeInReport: s.includeInReport === undefined ? true : Boolean(s.includeInReport),
          estimatedPrice: toN(s.estimatedPrice),
          tags: Array.isArray(s.tags) ? (s.tags as string[]) : [],
          linkedToSummaryId:
            s.linkedToSummaryId === null || s.linkedToSummaryId === undefined
              ? null
              : Number(s.linkedToSummaryId),
        }),
      );

      setSummaries(normalized);
    } catch {
      setGenerateError("Network error — please try again.");
    } finally {
      setGenerating(false);
    }
  }

  // parentId: the row whose "Compare To" dropdown changed.
  // newChildId: the newly selected comparison club (null = unlink).
  //
  // Relationship direction: the CHILD row stores linkedToSummaryId pointing at
  // the parent. So we PATCH the child row, not the parent row.
  //   Old child (if any) → PATCH { linkedToSummaryId: null }
  //   New child (if any) → PATCH { linkedToSummaryId: parentId }
  async function handleLinkChange(parentId: number, newChildId: number | null) {
    setLinkError(null);

    // Find the row currently linked to this parent (if any)
    const oldChild = summaries.find((s) => s.linkedToSummaryId === parentId) ?? null;

    if (oldChild?.id === newChildId) return; // no change

    // Optimistic update
    setSummaries((prev) =>
      prev.map((s) => {
        if (oldChild && s.id === oldChild.id) {
          // Unlink old child — leave includeInReport as-is (user re-enables manually)
          return { ...s, linkedToSummaryId: null };
        }
        if (newChildId !== null && s.id === newChildId) {
          // Link new child, force includeInReport = false
          return { ...s, linkedToSummaryId: parentId, includeInReport: false };
        }
        return s;
      }),
    );
    setLinking((prev) => new Set(prev).add(parentId));

    try {
      // Step 1: unlink old child (if any)
      if (oldChild) {
        const res = await fetch(
          `/api/staff/imports/${batchId}/club-summaries/${oldChild.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ linkedToSummaryId: null }),
          },
        );
        if (!res.ok) {
          // Revert optimistic unlink
          setSummaries((prev) =>
            prev.map((s) =>
              s.id === oldChild.id ? { ...s, linkedToSummaryId: parentId } : s,
            ),
          );
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          setLinkError(json.error ?? "Failed to update comparison link.");
          return;
        }
      }

      // Step 2: link new child (if selected)
      if (newChildId !== null) {
        const res = await fetch(
          `/api/staff/imports/${batchId}/club-summaries/${newChildId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ linkedToSummaryId: parentId }),
          },
        );
        if (!res.ok) {
          // Revert both optimistic changes
          setSummaries((prev) =>
            prev.map((s) => {
              if (oldChild && s.id === oldChild.id)
                return { ...s, linkedToSummaryId: parentId };
              if (s.id === newChildId) return { ...s, linkedToSummaryId: null };
              return s;
            }),
          );
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          setLinkError(json.error ?? "Failed to update comparison link.");
          return;
        }
        // Sync server response for the newly linked child
        const json = (await res.json().catch(() => null)) as {
          summary?: { linkedToSummaryId?: number | null; includeInReport?: boolean };
        } | null;
        if (json?.summary) {
          setSummaries((prev) =>
            prev.map((s) =>
              s.id === newChildId
                ? {
                    ...s,
                    linkedToSummaryId: json!.summary!.linkedToSummaryId ?? null,
                    includeInReport:
                      json!.summary!.includeInReport ?? s.includeInReport,
                  }
                : s,
            ),
          );
        }
      }

      if (finalized) setDirty(true);
    } catch {
      // Revert both optimistic changes on network error
      setSummaries((prev) =>
        prev.map((s) => {
          if (oldChild && s.id === oldChild.id)
            return { ...s, linkedToSummaryId: parentId };
          if (newChildId !== null && s.id === newChildId)
            return { ...s, linkedToSummaryId: null };
          return s;
        }),
      );
      setLinkError("Network error — please try again.");
    } finally {
      setLinking((prev) => {
        const next = new Set(prev);
        next.delete(parentId);
        return next;
      });
    }
  }

  function handleSaved(updated: SerializedClubSummary) {
    setSummaries((prev) =>
      prev.map((s) => (s.id === updated.id ? updated : s)),
    );
    // If the session was finalized, mark it as needing re-finalization
    if (finalized) setDirty(true);
  }

  function handlePriceSaved(summaryId: number, estimatedPrice: number | null) {
    setSummaries((prev) =>
      prev.map((summary) =>
        summary.id === summaryId ? { ...summary, estimatedPrice } : summary,
      ),
    );
    if (finalized) setDirty(true);
  }

  function handleShotSummaryUpdated(
    summaryId: number,
    metrics: ShotReviewSummaryMetrics,
  ) {
    setSummaries((prev) =>
      prev.map((summary) =>
        summary.id === summaryId ? { ...summary, ...metrics } : summary,
      ),
    );
    if (finalized) setDirty(true);
  }

  async function handleToggleInclude(id: number, currentIncluded: boolean) {
    // Guard: linked children cannot be toggled — their includeInReport is
    // controlled by the server when linkedToSummaryId is set/cleared.
    const summary = summaries.find((s) => s.id === id);
    if (summary?.linkedToSummaryId !== null && summary?.linkedToSummaryId !== undefined) return;

    const nextValue = !currentIncluded;
    setToggleError(null);
    // Optimistic update
    setSummaries((prev) =>
      prev.map((s) => (s.id === id ? { ...s, includeInReport: nextValue } : s)),
    );
    setToggling((prev) => new Set(prev).add(id));

    try {
      const res = await fetch(
        `/api/staff/imports/${batchId}/club-summaries/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ includeInReport: nextValue }),
        },
      );

      if (!res.ok) {
        // Revert and show error
        setSummaries((prev) =>
          prev.map((s) => (s.id === id ? { ...s, includeInReport: currentIncluded } : s)),
        );
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setToggleError(json.error ?? "Failed to update include status.");
      } else {
        // Sync with the value the server actually saved
        const json = (await res.json().catch(() => null)) as {
          summary?: { includeInReport?: boolean };
        } | null;
        if (json?.summary?.includeInReport !== undefined) {
          setSummaries((prev) =>
            prev.map((s) =>
              s.id === id
                ? { ...s, includeInReport: json!.summary!.includeInReport !== false }
                : s,
            ),
          );
        }
        // If the session was finalized, mark it as needing re-finalization
        if (finalized) setDirty(true);
      }
    } catch {
      // Revert on network error
      setSummaries((prev) =>
        prev.map((s) => (s.id === id ? { ...s, includeInReport: currentIncluded } : s)),
      );
      setToggleError("Network error — please try again.");
    } finally {
      setToggling((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Header row ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground font-heading">
            Review clubs
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground font-body">
            {hasSummaries
              ? `${summaries.length} club${summaries.length !== 1 ? "s" : ""} detected. Open a card to review its metrics and shots.`
              : parserMode === "trackman-result"
                ? "Club summaries were not generated during upload."
                : "No club summaries yet. Generate them from the shot rows below."}
          </p>
        </div>

        {/* Generate button — generic imports only; TrackMan generates during upload */}
        {!hasSummaries && parserMode !== "trackman-result" && (
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="shrink-0 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-xs hover:bg-primary-hover disabled:opacity-50 transition-colors font-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {generating ? "Generating…" : "Generate Club Averages"}
          </button>
        )}
      </div>

      {/* ── TrackMan fallback: summaries missing after upload ────────────── */}
      {!hasSummaries && parserMode === "trackman-result" && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-6 text-center dark:border-red-900/50 dark:bg-red-950/30">
          <p className="text-sm font-semibold text-red-700 font-body dark:text-red-400">
            Club summaries were not generated during upload.
          </p>
          <p className="mt-1 text-xs text-muted-foreground font-body">
            This is unexpected. You can regenerate them manually below.
          </p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="mt-4 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50 transition-colors font-body"
          >
            {generating ? "Generating…" : "Re-generate from raw shots"}
          </button>
        </div>
      )}

      {/* ── Generate error ──────────────────────────────────────────────────── */}
      {generateError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700 font-body dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          {generateError}
        </div>
      )}

      {/* ── Unassigned warning ──────────────────────────────────────────────── */}
      {hasUnassigned && (
        <div className="flex items-start gap-2 rounded-xl border border-accent/40 bg-accent/10 px-5 py-4 text-sm text-foreground font-body">
          <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <p>
            <span className="font-semibold font-subheading">
              Unassigned shots detected.
            </span>{" "}
            Some shots had a blank{" "}
            <code className="rounded bg-muted px-1 text-xs">Club.Type</code>{" "}
            column. Click{" "}
            <span className="font-semibold">Edit</span> on the Unassigned row to
            open the Unassigned club card and choose Edit before confirming.
          </p>
        </div>
      )}

      {/* ── Toggle error ────────────────────────────────────────────────────── */}
      {toggleError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700 font-body dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          {toggleError}
        </div>
      )}
      {/* ── Link error ───────────────────────────────────────────────────── */}
      {linkError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700 font-body dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          {linkError}
        </div>
      )}
      {/* ── Club review grid ────────────────────────────────────────────────── */}
      {hasSummaries && (
        <ClubReviewGrid
          batchId={batchId}
          parserMode={parserMode}
          summaries={summaries}
          toggling={toggling}
          linking={linking}
          onEdit={setEditingId}
          onToggleInclude={handleToggleInclude}
          onLinkChange={handleLinkChange}
          onPriceSaved={handlePriceSaved}
          onShotSummaryUpdated={handleShotSummaryUpdated}
        />
      )}

      {/* ── Finalize section ────────────────────────────────────────────────── */}
      {hasSummaries && (
        <div className="rounded-xl border border-border bg-card px-5 py-5 shadow-xs">
          {finalized && !dirty ? (
            // ── Clean finalized state ────────────────────────────────────────────
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <IconCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <p className="text-sm font-semibold text-foreground font-subheading">
                    Session Finalized
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground font-body">
                    Demo session finalized successfully. Club averages have been saved.
                  </p>
                </div>
              </div>
              <span className="shrink-0 inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 font-subheading dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400">
                Finalized
              </span>
            </div>
          ) : (
            // ── Not yet finalized, OR finalized-but-dirty (needs re-finalization) ───────
            <div className="flex flex-col gap-3">
              {/* Dirty warning banner */}
              {finalized && dirty && (
                <div className="flex items-start gap-3 rounded-lg border border-accent/40 bg-accent/10 px-4 py-3">
                  <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <div>
                    <p className="text-sm font-semibold text-foreground font-subheading">
                      Club summaries have changed since finalization.
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground font-body">
                      Re-finalize this session to update the saved club data.
                    </p>
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground font-subheading">
                    {dirty ? "Ready to re-finalize?" : "Ready to finalize?"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground font-body">
                    Review and edit club averages above. Only included clubs will
                    be saved. This action cannot be undone.
                  </p>
                  {!sessionId && (
                    <p className="mt-2 text-xs font-medium text-accent font-body">
                      Assignment required before finalizing
                    </p>
                  )}
                  {finalizeError && (
                    <p className="mt-2 text-xs text-red-600 dark:text-red-400 font-body">
                      {finalizeError}
                    </p>
                  )}
                </div>
                <button
                  disabled={finalizing || !sessionId}
                  onClick={() => {
                    if (!sessionId) return;
                    setFinalizing(true);
                    setFinalizeError(null);
                    fetch(`/api/staff/demo-sessions/${sessionId}/finalize`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ batchId }),
                    })
                      .then(async (res) => {
                        const data = (await res.json().catch(() => ({}))) as {
                          success?: boolean;
                          alreadyFinalized?: boolean;
                          error?: string;
                        };
                        if (!res.ok || !data.success) {
                          setFinalizeError(
                            data.error ?? "Failed to finalize. Please try again.",
                          );
                        } else {
                          setFinalized(true);
                          setDirty(false);
                        }
                      })
                      .catch(() => {
                        setFinalizeError("Network error — please try again.");
                      })
                      .finally(() => setFinalizing(false));
                  }}
                  className="shrink-0 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-xs hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  {finalizing
                    ? dirty
                      ? "Re-Finalizing…"
                      : "Finalizing…"
                    : dirty
                      ? "Re-Finalize Session"
                      : "Finalize Session"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Regenerate option ───────────────────────────────────────────────── */}
      {hasSummaries && parserMode !== "trackman-result" && (
        <div className="flex items-center justify-end">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 font-body disabled:opacity-40"
          >
            {generating ? "Regenerating…" : "Re-generate from raw shots"}
          </button>
        </div>
      )}

      {/* ── Edit modal ──────────────────────────────────────────────────────── */}
      {editingSummary && (
        <EditClubSummaryModal
          batchId={batchId}
          summary={editingSummary}
          onClose={() => setEditingId(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
