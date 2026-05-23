"use client";

import { useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import {
  EditClubSummaryModal,
  type SerializedClubSummary,
} from "./EditClubSummaryModal";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number | null, decimals = 1): string {
  if (v === null) return "—";
  return v.toFixed(decimals);
}

function fmtInt(v: number | null): string {
  if (v === null) return "—";
  return Math.round(v).toLocaleString();
}

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
  // Set of summary IDs that already have a comparison child linked to them
  const parentIds = new Set(
    summaries
      .filter((s) => s.linkedToSummaryId !== null)
      .map((s) => s.linkedToSummaryId!),
  );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setSummaries((prev) => {
        const oldIndex = prev.findIndex((s) => s.id === active.id);
        const newIndex = prev.findIndex((s) => s.id === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }

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
          <h2 className="text-lg font-bold text-slate-900 font-heading">
            Club Averages
          </h2>
          <p className="mt-0.5 text-sm text-slate-500 font-body">
            {hasSummaries
              ? `${summaries.length} club${summaries.length !== 1 ? "s" : ""} detected from shot data.`
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
            className="shrink-0 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50 transition-colors font-body"
          >
            {generating ? "Generating…" : "Generate Club Averages"}
          </button>
        )}
      </div>

      {/* ── TrackMan fallback: summaries missing after upload ────────────── */}
      {!hasSummaries && parserMode === "trackman-result" && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-6 text-center">
          <p className="text-sm font-semibold text-red-700 font-body">
            Club summaries were not generated during upload.
          </p>
          <p className="mt-1 text-xs text-slate-500 font-body">
            This is unexpected. You can regenerate them manually below.
          </p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="mt-4 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors font-body"
          >
            {generating ? "Generating…" : "Re-generate from raw shots"}
          </button>
        </div>
      )}

      {/* ── Generate error ──────────────────────────────────────────────────── */}
      {generateError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700 font-body">
          {generateError}
        </div>
      )}

      {/* ── Unassigned warning ──────────────────────────────────────────────── */}
      {hasUnassigned && (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-5 py-4 text-sm text-yellow-800 font-body">
          <span className="font-semibold font-subheading">
            ⚠ Unassigned shots detected.
          </span>{" "}
          Some shots had a blank{" "}
          <code className="rounded bg-yellow-100 px-1 text-xs">Club.Type</code>{" "}
          column. Click{" "}
          <span className="font-semibold">Edit</span> on the Unassigned row to
          assign a club name before confirming.
        </div>
      )}

      {/* ── Toggle error ────────────────────────────────────────────────────── */}
      {toggleError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700 font-body">
          {toggleError}
        </div>
      )}
      {/* ── Link error ───────────────────────────────────────────────────── */}
      {linkError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700 font-body">
          {linkError}
        </div>
      )}
      {/* ── Club summary table ──────────────────────────────────────────────── */}
      {hasSummaries && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <table className="w-full min-w-[1950px] text-sm font-body">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="w-10 px-3 py-3 font-subheading" />
                  <th className="min-w-[100px] whitespace-nowrap px-5 py-3 font-subheading">Actions</th>
                  <th className="min-w-[90px] whitespace-nowrap px-5 py-3 font-subheading text-center">Include</th>
                  <th className="min-w-[140px] whitespace-nowrap px-5 py-3 font-subheading">Club</th>
                  <th className="min-w-[140px] whitespace-nowrap px-5 py-3 font-subheading">Tags</th>
                  <th className="min-w-[180px] whitespace-nowrap px-5 py-3 font-subheading">Compare To</th>
                  <th className="min-w-[130px] whitespace-nowrap px-5 py-3 font-subheading text-right">Est. Price</th>
                  <th className="min-w-[90px] whitespace-nowrap px-5 py-3 font-subheading text-center">Shots</th>
                  <th className="min-w-[160px] whitespace-nowrap px-5 py-3 font-subheading text-right">Avg Club Speed</th>
                  <th className="min-w-[160px] whitespace-nowrap px-5 py-3 font-subheading text-right">Avg Ball Speed</th>
                  <th className="min-w-[150px] whitespace-nowrap px-5 py-3 font-subheading text-right">Avg Spin</th>
                  <th className="min-w-[150px] whitespace-nowrap px-5 py-3 font-subheading text-right">Avg Height</th>
                  <th className="min-w-[150px] whitespace-nowrap px-5 py-3 font-subheading text-right">Avg Carry</th>
                  <th className="min-w-[150px] whitespace-nowrap px-5 py-3 font-subheading text-right">Avg Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <SortableContext
                  items={summaries.map((s) => s.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {summaries.map((s) => {
                    // The child currently linked to this row (if any)
                    const currentChild = summaries.find(
                      (c) => c.linkedToSummaryId === s.id,
                    );
                    const currentChildId = currentChild?.id ?? null;

                    // Potential children for this row's dropdown:
                    //   - not self
                    //   - not already someone else's child (linkedToSummaryId === null,
                    //     OR linkedToSummaryId === s.id meaning it IS our current child)
                    //   - not already acting as a parent themselves (can't be both)
                    const compareOptions = summaries.filter(
                      (candidate) =>
                        candidate.id !== s.id &&
                        (candidate.linkedToSummaryId === null ||
                          candidate.linkedToSummaryId === s.id) &&
                        !parentIds.has(candidate.id),
                    );
                    return (
                    <SortableRow
                      key={s.id}
                      summary={s}
                      isToggling={toggling.has(s.id)}
                      onEdit={() => setEditingId(s.id)}
                      onToggleInclude={(current) => handleToggleInclude(s.id, current)}
                      isParent={parentIds.has(s.id)}
                      currentChildId={currentChildId}
                      compareOptions={compareOptions}
                      onLinkChange={(newChildId) => handleLinkChange(s.id, newChildId)}
                      isLinking={linking.has(s.id)}
                    />
                    );
                  })}
                </SortableContext>
              </tbody>
            </table>
          </DndContext>
        </div>
      )}

      {/* ── Finalize section ────────────────────────────────────────────────── */}
      {hasSummaries && (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-5 shadow-xs">
          {finalized && !dirty ? (
            // ── Clean finalized state ────────────────────────────────────────────
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-emerald-700 font-subheading">
                  ✓ Session Finalized
                </p>
                <p className="mt-0.5 text-xs text-slate-500 font-body">
                  Demo session finalized successfully. Club averages have been saved.
                </p>
              </div>
              <span className="shrink-0 inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 font-subheading">
                Finalized
              </span>
            </div>
          ) : (
            // ── Not yet finalized, OR finalized-but-dirty (needs re-finalization) ───────
            <div className="flex flex-col gap-3">
              {/* Dirty warning banner */}
              {finalized && dirty && (
                <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                  <span className="mt-0.5 shrink-0 text-amber-500" aria-hidden>&#9888;</span>
                  <div>
                    <p className="text-sm font-semibold text-amber-800 font-subheading">
                      Club summaries have changed since finalization.
                    </p>
                    <p className="mt-0.5 text-xs text-amber-700 font-body">
                      Re-finalize this session to update the saved club data.
                    </p>
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-700 font-subheading">
                    {dirty ? "Ready to re-finalize?" : "Ready to finalize?"}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500 font-body">
                    Review and edit club averages above. Only included clubs will
                    be saved. This action cannot be undone.
                  </p>
                  {finalizeError && (
                    <p className="mt-2 text-xs text-red-600 font-body">{finalizeError}</p>
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
                  className="shrink-0 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-body"
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
      {hasSummaries && (
        <div className="flex items-center justify-end">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2 font-body disabled:opacity-40"
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

// ── Metric table cell ─────────────────────────────────────────────────────────

function MetricCell({
  value,
  valid,
  total,
  unit,
}: {
  value: string;
  valid: number;
  total: number;
  unit: string;
}) {
  const isNull = value === "—";
  return (
    <td className="whitespace-nowrap px-5 py-4 text-right">
      <div className="space-y-0.5">
        {/* Value + unit inline */}
        <div className="inline-flex items-baseline gap-1 whitespace-nowrap">
          <span className={isNull ? "text-slate-300" : "text-slate-800"}>
            {value}
          </span>
          {!isNull && (
            <span className="text-xs text-slate-400">{unit}</span>
          )}
        </div>
        {/* Valid count — always shown */}
        <div className="text-xs text-slate-400">
          {isNull ? `0/${total}` : `${valid}/${total}`}
        </div>
      </div>
    </td>
  );
}

// ── Sortable row ──────────────────────────────────────────────────────────────

interface SortableRowProps {
  summary: SerializedClubSummary;
  isToggling: boolean;
  onEdit: () => void;
  onToggleInclude: (currentIncluded: boolean) => void;
  isParent: boolean;
  /** ID of the child summary currently linked to this row (null if none). */
  currentChildId: number | null;
  /** Summaries eligible to become this row's comparison child. */
  compareOptions: SerializedClubSummary[];
  onLinkChange: (newChildId: number | null) => void;
  isLinking: boolean;
}

function SortableRow({
  summary: s,
  isToggling,
  onEdit,
  onToggleInclude,
  isParent,
  currentChildId,
  compareOptions,
  onLinkChange,
  isLinking,
}: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: s.id });

  const isIncluded = s.includeInReport !== false;
  const isChild = s.linkedToSummaryId !== null;

  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      className={`transition-colors ${
        isDragging
          ? "relative z-10 opacity-60 shadow-lg"
          : isChild
            ? "bg-indigo-50/40"
            : !isIncluded
              ? "bg-slate-200/60 opacity-50 grayscale"
              : "hover:bg-slate-50/60"
      }`}
    >
      {/* Drag handle */}
      <td className="whitespace-nowrap px-3 py-4">
        <button
          {...listeners}
          type="button"
          tabIndex={-1}
          aria-label="Drag to reorder"
          className="cursor-grab active:cursor-grabbing touch-none text-slate-400 hover:text-slate-600"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </td>
      {/* Actions */}
      <td className="whitespace-nowrap px-5 py-4">
        <button
          onClick={onEdit}
          className="rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors"
        >
          Edit
        </button>
      </td>
      {/* Include toggle */}
      <td className="whitespace-nowrap px-5 py-4 text-center">
        <button
          role="switch"
          aria-checked={!isChild && isIncluded}
          disabled={isToggling || isChild}
          onClick={() => {
            if (!isChild) onToggleInclude(isIncluded);
          }}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
            isChild
              ? "cursor-not-allowed bg-slate-200"
              : isToggling
                ? "cursor-wait bg-emerald-500"
                : isIncluded
                  ? "cursor-pointer bg-emerald-500"
                  : "cursor-pointer bg-slate-300"
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
              !isChild && isIncluded ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
        {isChild ? (
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-500">
            Linked comparison
          </div>
        ) : !isIncluded ? (
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Excluded
          </div>
        ) : null}
      </td>
      {/* Club */}
      <td className="whitespace-nowrap px-5 py-4">
        {s.clubName === "Unassigned" ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-yellow-300 bg-yellow-50 px-2 py-0.5 text-xs font-semibold text-yellow-700">
            ⚠ Unassigned
          </span>
        ) : (
          <span className="font-medium text-slate-800">{s.clubName}</span>
        )}
      </td>
      {/* Tags — for this Club+Tags group */}
      <td className="px-5 py-4 text-sm">
        {s.tags.length > 0 ? (
          <span className="text-slate-700">{s.tags.join(", ")}</span>
        ) : (
          <span className="text-slate-300 text-xs">None</span>
        )}
      </td>
      {/* Compare To — select which club should be linked as a comparison child.
           Child rows (isChild) cannot also be parents, so they show no dropdown. */}
      <td className="whitespace-nowrap px-5 py-4">
        {isChild ? (
          <span className="text-xs text-slate-400">—</span>
        ) : (
          <select
            disabled={isLinking}
            value={currentChildId ?? ""}
            onChange={(e) =>
              onLinkChange(
                e.target.value === "" ? null : parseInt(e.target.value, 10),
              )
            }
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:border-indigo-400 focus:outline-none disabled:opacity-50"
          >
            <option value="">None</option>
            {compareOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.clubName}
                {opt.tags.length > 0 ? ` — ${opt.tags.join(", ")}` : ""}
              </option>
            ))}
          </select>
        )}
      </td>
      {/* Est. Price */}
      <td className="whitespace-nowrap px-5 py-4 text-right text-slate-700">
        {s.estimatedPrice !== null && s.estimatedPrice !== undefined ? (
          <span className="font-medium">${s.estimatedPrice.toFixed(2)}</span>
        ) : (
          <span className="text-slate-300 text-xs">—</span>
        )}
      </td>
      {/* Shots */}
      <td className="whitespace-nowrap px-5 py-4 text-center text-slate-600">
        {s.shotCount}
      </td>
      <MetricCell value={fmt(s.avgClubSpeed)} valid={s.validClubSpeedCount} total={s.shotCount} unit="mph" />
      <MetricCell value={fmt(s.avgBallSpeed)} valid={s.validBallSpeedCount} total={s.shotCount} unit="mph" />
      <MetricCell value={fmtInt(s.avgSpinRate)} valid={s.validSpinRateCount} total={s.shotCount} unit="rpm" />
      <MetricCell value={fmt(s.avgMaxHeight)} valid={s.validMaxHeightCount} total={s.shotCount} unit="yrd" />
      <MetricCell value={fmt(s.avgCarry)} valid={s.validCarryCount} total={s.shotCount} unit="yrd" />
      <MetricCell value={fmt(s.avgTotal)} valid={s.validTotalCount} total={s.shotCount} unit="yrd" />
    </tr>
  );
}
