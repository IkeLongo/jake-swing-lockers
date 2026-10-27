"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconAlertTriangle, IconArrowUpRight, IconX } from "@tabler/icons-react";
import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react";
import { useOutsideClick } from "@/hooks/use-outside-click";
import {
  canSelectTest,
  getCurrentForTest,
  getTestsForCurrent,
  type SetCurrentTestsResponse,
} from "./clubComparison";
import type { SerializedClubSummary } from "./clubSummaryTypes";

interface ShotReviewShot {
  id: number;
  rowIndex: number;
  included: boolean;
  clubSpeed: string | null;
  ballSpeed: string | null;
  spinRate: string | null;
  maxHeight: string | null;
  carry: string | null;
  total: string | null;
}

interface ShotReviewResponse {
  shots: ShotReviewShot[];
}

export type ShotReviewSummaryMetrics = Pick<
  SerializedClubSummary,
  | "shotCount"
  | "avgClubSpeed"
  | "avgBallSpeed"
  | "avgSpinRate"
  | "avgMaxHeight"
  | "avgCarry"
  | "avgTotal"
  | "validClubSpeedCount"
  | "validBallSpeedCount"
  | "validSpinRateCount"
  | "validMaxHeightCount"
  | "validCarryCount"
  | "validTotalCount"
>;

interface ShotReviewPatchResponse {
  success: true;
  shot: { id: number; included: boolean };
  summary: { id: number } & ShotReviewSummaryMetrics;
}

interface ClubReviewGridProps {
  batchId: number;
  parserMode?: string;
  summaries: SerializedClubSummary[];
  toggling: Set<number>;
  onIdentitySaved: (
    summaryId: number,
    identity: ClubIdentity,
  ) => void;
  onToggleInclude: (summaryId: number, currentIncluded: boolean) => void;
  onSaveTests: (
    currentSummaryId: number,
    testSummaryIds: number[],
  ) => Promise<SetCurrentTestsResponse>;
  onPriceSaved: (summaryId: number, price: number | null) => void;
  onShotSummaryUpdated: (
    summaryId: number,
    metrics: ShotReviewSummaryMetrics,
  ) => void;
}

const sharedTransition = { type: "spring", stiffness: 260, damping: 28 } as const;

const summaryCountKeys = [
  "shotCount",
  "validClubSpeedCount",
  "validBallSpeedCount",
  "validSpinRateCount",
  "validMaxHeightCount",
  "validCarryCount",
  "validTotalCount",
] as const;

const summaryAverageKeys = [
  "avgClubSpeed",
  "avgBallSpeed",
  "avgSpinRate",
  "avgMaxHeight",
  "avgCarry",
  "avgTotal",
] as const;

function isShotReviewPatchResponse(
  value: unknown,
): value is ShotReviewPatchResponse {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const result = value as Record<string, unknown>;
  if (
    result.success !== true ||
    result.shot === null ||
    typeof result.shot !== "object" ||
    Array.isArray(result.shot) ||
    result.summary === null ||
    typeof result.summary !== "object" ||
    Array.isArray(result.summary)
  ) {
    return false;
  }

  const shot = result.shot as Record<string, unknown>;
  const summary = result.summary as Record<string, unknown>;
  return (
    typeof shot.id === "number" &&
    Number.isSafeInteger(shot.id) &&
    typeof shot.included === "boolean" &&
    typeof summary.id === "number" &&
    Number.isSafeInteger(summary.id) &&
    summaryCountKeys.every(
      (key) =>
        typeof summary[key] === "number" &&
        Number.isSafeInteger(summary[key]) &&
        (summary[key] as number) >= 0,
    ) &&
    summaryAverageKeys.every(
      (key) =>
        summary[key] === null ||
        (typeof summary[key] === "number" &&
          Number.isFinite(summary[key])),
    )
  );
}

function apiErrorMessage(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const error = (value as Record<string, unknown>).error;
  return typeof error === "string" ? error : null;
}

function metric(value: number | null, decimals = 1): string {
  return value === null ? "—" : value.toFixed(decimals);
}

function shotMetric(value: string | null, decimals = 1): string {
  if (value === null || value.trim() === "") return "—";
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "—";
  return decimals === 0
    ? Math.round(numericValue).toLocaleString()
    : numericValue.toFixed(decimals);
}

function shotCountLabel(count: number): string {
  return `${count} ${count === 1 ? "shot" : "shots"}`;
}

export function ClubReviewGrid({
  batchId,
  parserMode,
  summaries,
  toggling,
  onIdentitySaved,
  onToggleInclude,
  onSaveTests,
  onPriceSaved,
  onShotSummaryUpdated,
}: ClubReviewGridProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [shotData, setShotData] = useState<Record<number, ShotReviewResponse>>({});
  const [shotErrors, setShotErrors] = useState<Record<number, string>>({});
  const [shotActionErrors, setShotActionErrors] = useState<
    Record<number, string>
  >({});
  const [savingShotIds, setSavingShotIds] = useState<Set<number>>(new Set());
  const [loadingIds, setLoadingIds] = useState<Set<number>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const requestsRef = useRef(new Map<number, AbortController>());
  const savingShotIdsRef = useRef(new Set<number>());

  const expandedSummary =
    summaries.find((summary) => summary.id === expandedId) ?? null;

  const closeSummary = useCallback(() => {
    setExpandedId(null);
  }, []);

  useOutsideClick(panelRef, closeSummary);

  const loadShots = useCallback(
    (summaryId: number, force = false) => {
      if (parserMode !== "trackman-result") return;
      if (!force && (shotData[summaryId] || loadingIds.has(summaryId))) return;

      requestsRef.current.get(summaryId)?.abort();
      const controller = new AbortController();
      requestsRef.current.set(summaryId, controller);
      setLoadingIds((current) => new Set(current).add(summaryId));
      setShotErrors((current) => {
        const next = { ...current };
        delete next[summaryId];
        return next;
      });

      void fetch(
        `/api/staff/imports/${batchId}/club-summaries/${summaryId}/shots`,
        { signal: controller.signal },
      )
        .then(async (response) => {
          const result = (await response.json()) as
            | ShotReviewResponse
            | { error?: string };
          if (!response.ok) {
            throw new Error(
              "error" in result && result.error
                ? result.error
                : "Could not load shots for this club.",
            );
          }
          if (!("shots" in result) || !Array.isArray(result.shots)) {
            throw new Error("The shot response was incomplete. Please try again.");
          }
          setShotData((current) => ({ ...current, [summaryId]: result }));
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setShotErrors((current) => ({
            ...current,
            [summaryId]:
              error instanceof Error
                ? error.message
                : "Could not load shots for this club.",
          }));
        })
        .finally(() => {
          if (requestsRef.current.get(summaryId) === controller) {
            requestsRef.current.delete(summaryId);
            setLoadingIds((current) => {
              const next = new Set(current);
              next.delete(summaryId);
              return next;
            });
          }
        });
    },
    [batchId, loadingIds, parserMode, shotData],
  );

  async function handleShotInclusionChange(
    summaryId: number,
    shot: ShotReviewShot,
    included: boolean,
  ) {
    if (savingShotIdsRef.current.has(shot.id)) return;

    savingShotIdsRef.current.add(shot.id);
    setSavingShotIds((current) => new Set(current).add(shot.id));
    setShotActionErrors((current) => {
      const next = { ...current };
      delete next[shot.id];
      return next;
    });

    try {
      const response = await fetch(
        `/api/staff/imports/${batchId}/club-summaries/${summaryId}/shots/${shot.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ included }),
        },
      );
      const result: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          apiErrorMessage(result) ?? "Could not update this shot.",
        );
      }
      if (
        !isShotReviewPatchResponse(result) ||
        result.shot.id !== shot.id ||
        result.shot.included !== included ||
        result.summary.id !== summaryId
      ) {
        throw new Error("The shot update response was invalid. Please try again.");
      }

      setShotData((current) => {
        const cached = current[summaryId];
        if (!cached) return current;
        return {
          ...current,
          [summaryId]: {
            ...cached,
            shots: cached.shots.map((cachedShot) =>
              cachedShot.id === shot.id
                ? { ...cachedShot, included: result.shot.included }
                : cachedShot,
            ),
          },
        };
      });
      onShotSummaryUpdated(summaryId, result.summary);
    } catch (error: unknown) {
      setShotActionErrors((current) => ({
        ...current,
        [shot.id]:
          error instanceof Error
            ? error.message
            : "Could not update this shot. Please try again.",
      }));
    } finally {
      savingShotIdsRef.current.delete(shot.id);
      setSavingShotIds((current) => {
        const next = new Set(current);
        next.delete(shot.id);
        return next;
      });
    }
  }

  function openSummary(summaryId: number, trigger: HTMLElement) {
    returnFocusRef.current = trigger;
    setExpandedId(summaryId);
    loadShots(summaryId);
  }

  useEffect(
    () => () => {
      requestsRef.current.forEach((controller) => controller.abort());
      requestsRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    if (expandedId === null) return;

    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPaddingRight = document.body.style.paddingRight;
    const viewportScrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;
    if (viewportScrollbarWidth > 0) {
      const bodyPaddingRight = Number.parseFloat(
        window.getComputedStyle(document.body).paddingRight,
      );
      document.body.style.paddingRight = `${
        bodyPaddingRight + viewportScrollbarWidth
      }px`;
    }
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    const scrollableAncestors: Array<{
      element: HTMLElement;
      overflowY: string;
      paddingRight: string;
    }> = [];
    let ancestor = returnFocusRef.current?.parentElement ?? null;
    while (ancestor && ancestor !== document.body) {
      const overflowY = window.getComputedStyle(ancestor).overflowY;
      if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
        const scrollbarWidth = ancestor.offsetWidth - ancestor.clientWidth;
        const paddingRight = ancestor.style.paddingRight;
        scrollableAncestors.push({
          element: ancestor,
          overflowY: ancestor.style.overflowY,
          paddingRight,
        });
        if (scrollbarWidth > 0) {
          const currentPadding = Number.parseFloat(
            window.getComputedStyle(ancestor).paddingRight,
          );
          ancestor.style.paddingRight = `${currentPadding + scrollbarWidth}px`;
        }
        ancestor.style.overflowY = "hidden";
      }
      ancestor = ancestor.parentElement;
    }

    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSummary();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown);
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.paddingRight = previousBodyPaddingRight;
      for (const item of scrollableAncestors) {
        item.element.style.overflowY = item.overflowY;
        item.element.style.paddingRight = item.paddingRight;
      }
      if (expandedId !== null) {
        window.requestAnimationFrame(() => {
          if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
        });
      }
    };
  }, [closeSummary, expandedId]);

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {summaries.map((summary) => {
          return (
            <ClubCard
              key={summary.id}
              summary={summary}
              isExpanded={expandedId === summary.id}
              summaries={summaries}
              onOpen={openSummary}
            />
          );
        })}
      </div>

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {expandedSummary && (
              <motion.div
                key={`backdrop-${expandedSummary.id}`}
                className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black/40 p-3 backdrop-blur-[2px] sm:p-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) closeSummary();
                }}
                onTouchStart={(event) => {
                  if (event.target === event.currentTarget) closeSummary();
                }}
              >
                <motion.div
                  ref={panelRef}
                  layoutId={`club-review-card-${expandedSummary.id}`}
                  transition={sharedTransition}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby={`club-review-title-${expandedSummary.id}`}
                  tabIndex={-1}
                  className="relative z-10 flex max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-2xl outline-none sm:max-h-[calc(100dvh-3rem)]"
                >
                  <button
                    ref={closeButtonRef}
                    type="button"
                    onClick={closeSummary}
                    aria-label="Close club details"
                    className="absolute right-3 top-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:right-5 sm:top-5"
                  >
                    <IconX className="h-5 w-5" />
                  </button>

                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                    <ExpandedClubDetail
                      batchId={batchId}
                      parserMode={parserMode}
                      summary={expandedSummary}
                      shotData={shotData[expandedSummary.id]}
                      savingShotIds={savingShotIds}
                      shotActionErrors={shotActionErrors}
                      loading={loadingIds.has(expandedSummary.id)}
                      error={shotErrors[expandedSummary.id] ?? null}
                      onRetry={() => loadShots(expandedSummary.id, true)}
                      isToggling={toggling.has(expandedSummary.id)}
                      onIdentitySaved={(identity) =>
                        onIdentitySaved(expandedSummary.id, identity)
                      }
                      onToggleInclude={() =>
                        onToggleInclude(
                          expandedSummary.id,
                          expandedSummary.includeInReport !== false,
                        )
                      }
                      summaries={summaries}
                      onSaveTests={onSaveTests}
                      onOpenSummary={(summaryId) => {
                        setExpandedId(summaryId);
                        loadShots(summaryId);
                      }}
                      onPriceSaved={(price) =>
                        onPriceSaved(expandedSummary.id, price)
                      }
                      onShotInclusionChange={(shot, included) =>
                        handleShotInclusionChange(
                          expandedSummary.id,
                          shot,
                          included,
                        )
                      }
                    />
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}

interface ClubCardProps {
  summary: SerializedClubSummary;
  isExpanded: boolean;
  summaries: SerializedClubSummary[];
  onOpen: (summaryId: number, trigger: HTMLElement) => void;
}

function ClubCard({
  summary,
  isExpanded,
  summaries,
  onOpen,
}: ClubCardProps) {
  const isIncluded = summary.includeInReport !== false;
  const current = getCurrentForTest(summaries, summary);
  const hasStatusBadges = !isIncluded || summary.clubName === "Unassigned";

  return (
    <motion.button
        layoutId={`club-review-card-${summary.id}`}
        transition={sharedTransition}
        type="button"
        onClick={(event) => onOpen(summary.id, event.currentTarget)}
        aria-haspopup="dialog"
        aria-expanded={isExpanded}
        aria-label={`View ${summary.clubName} details, ${shotCountLabel(summary.shotCount)}`}
        className={`group flex h-full w-full cursor-pointer flex-col rounded-2xl border bg-card p-5 text-left text-foreground shadow-xs transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
          !isIncluded
            ? "border-border opacity-65"
            : "border-border hover:border-primary/30"
        }`}
      >
        {hasStatusBadges && (
        <div className="flex flex-wrap items-center gap-2">
          {!isIncluded && (
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Excluded
            </span>
          )}
          {summary.clubName === "Unassigned" && (
            <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
              <IconAlertTriangle className="h-3 w-3" />
              Unassigned
            </span>
          )}
        </div>
        )}

        <h3 className={`${hasStatusBadges ? "mt-2 " : ""}line-clamp-1 pr-1 font-heading text-lg font-bold tracking-tight`}>
          {summary.clubName}
        </h3>
        {summary.tags.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {summary.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md border border-border bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">No tags</p>
        )}

        <div className="mt-5 border-t border-border pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Avg carry
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-heading text-4xl font-bold tracking-tight text-foreground">
              {metric(summary.avgCarry)}
            </span>
            <span className="text-sm font-medium text-muted-foreground">yd</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Avg total{" "}
            <span className="font-semibold text-foreground">
              {metric(summary.avgTotal)} yd
            </span>
          </p>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-4">
          <CompactMetric
            label="Ball speed"
            value={metric(summary.avgBallSpeed)}
            unit="mph"
          />
          <CompactMetric
            label="Club speed"
            value={metric(summary.avgClubSpeed)}
            unit="mph"
          />
          <CompactMetric
            label="Spin"
            value={
              summary.avgSpinRate === null
                ? "—"
                : Math.round(summary.avgSpinRate).toLocaleString()
            }
            unit="rpm"
          />
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 pt-5 text-xs">
          <span className="text-muted-foreground">{shotCountLabel(summary.shotCount)}</span>
          {current ? (
            <span className="max-w-[60%] truncate text-right text-muted-foreground">
              Compared with {current.clubName}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 font-semibold text-primary">
              View details <IconArrowUpRight className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
      </motion.button>
  );
}

function CompactMetric({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold tabular-nums text-foreground">
        {value}
        {value !== "—" && (
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            {unit}
          </span>
        )}
      </p>
    </div>
  );
}

export type ClubIdentity = Pick<
  SerializedClubSummary,
  "clubName" | "tags" | "isManuallyEdited"
>;

interface ClubSummarySavedResponse {
  success: true;
  summary: { clubName: string; tags: string[]; isManuallyEdited: boolean };
}

function isClubSummarySavedResponse(
  value: unknown,
): value is ClubSummarySavedResponse {
  if (value === null || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  if (result.success !== true) return false;
  const summary = result.summary as Record<string, unknown> | null | undefined;
  return (
    summary !== null &&
    typeof summary === "object" &&
    typeof summary.clubName === "string" &&
    Array.isArray(summary.tags) &&
    summary.tags.every((tag) => typeof tag === "string") &&
    typeof summary.isManuallyEdited === "boolean"
  );
}

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

interface ClubIdentityEditorProps {
  batchId: number;
  summary: SerializedClubSummary;
  onSaved: (identity: ClubIdentity) => void;
}

function ClubIdentityEditor({
  batchId,
  summary,
  onSaved,
}: ClubIdentityEditorProps) {
  const [editing, setEditing] = useState(false);
  const [clubName, setClubName] = useState(summary.clubName);
  const [tags, setTags] = useState(summary.tags.join(", "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    setClubName(summary.clubName);
    setTags(summary.tags.join(", "));
    setError(null);
    setEditing(true);
  }

  function cancel() {
    if (saving) return;
    setError(null);
    setEditing(false);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const trimmedName = clubName.trim();
    if (trimmedName === "") {
      setError("Club name cannot be blank.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/staff/imports/${batchId}/club-summaries/${summary.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clubName: trimmedName,
            tags: parseTags(tags),
          }),
        },
      );
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(apiErrorMessage(result) ?? "Could not save club details.");
      }
      if (!isClubSummarySavedResponse(result)) {
        throw new Error("The save response was invalid. Please try again.");
      }
      onSaved({
        clubName: result.summary.clubName,
        tags: result.summary.tags,
        isManuallyEdited: result.summary.isManuallyEdited,
      });
      setEditing(false);
    } catch (saveError: unknown) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Network error — please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <form
        onSubmit={save}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancel();
          }
        }}
        className="mt-2 max-w-md space-y-3"
        noValidate
      >
        <div>
          <label
            htmlFor={`club-name-${summary.id}`}
            className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Club name
          </label>
          <input
            id={`club-name-${summary.id}`}
            type="text"
            value={clubName}
            onChange={(event) => setClubName(event.target.value)}
            disabled={saving}
            autoFocus
            className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
          />
        </div>
        <div>
          <label
            htmlFor={`club-tags-${summary.id}`}
            className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Tags
          </label>
          <input
            id={`club-tags-${summary.id}`}
            type="text"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            disabled={saving}
            placeholder="Comma-separated"
            className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
          />
        </div>
        {error && (
          <p className="text-xs text-red-700 dark:text-red-400" role="alert">
            {error}
          </p>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={cancel}
            disabled={saving}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <>
      <div className="mt-2 flex items-start gap-3">
        <h2
          id={`club-review-title-${summary.id}`}
          className="font-heading text-2xl font-bold tracking-tight sm:text-3xl"
        >
          {summary.clubName}
        </h2>
        <button
          type="button"
          onClick={startEditing}
          aria-label={`Edit ${summary.clubName} name and tags`}
          className="mt-1.5 shrink-0 rounded-md px-1.5 py-0.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:mt-2.5"
        >
          Edit
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {summary.tags.length > 0 ? (
          summary.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md border border-border bg-muted/60 px-2 py-1 text-xs"
            >
              {tag}
            </span>
          ))
        ) : (
          <span>No tags</span>
        )}
        <span aria-hidden="true">·</span>
        <span>{shotCountLabel(summary.shotCount)}</span>
      </div>
    </>
  );
}

interface ExpandedClubDetailProps {
  batchId: number;
  parserMode?: string;
  summary: SerializedClubSummary;
  shotData?: ShotReviewResponse;
  savingShotIds: Set<number>;
  shotActionErrors: Record<number, string>;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  isToggling: boolean;
  onIdentitySaved: (identity: ClubIdentity) => void;
  onPriceSaved: (price: number | null) => void;
  onShotInclusionChange: (
    shot: ShotReviewShot,
    included: boolean,
  ) => void;
  onToggleInclude: () => void;
  summaries: SerializedClubSummary[];
  onSaveTests: (
    currentSummaryId: number,
    testSummaryIds: number[],
  ) => Promise<SetCurrentTestsResponse>;
  onOpenSummary: (summaryId: number) => void;
}

function ExpandedClubDetail({
  batchId,
  parserMode,
  summary,
  shotData,
  savingShotIds,
  shotActionErrors,
  loading,
  error,
  onRetry,
  isToggling,
  onIdentitySaved,
  onPriceSaved,
  onShotInclusionChange,
  onToggleInclude,
  summaries,
  onSaveTests,
  onOpenSummary,
}: ExpandedClubDetailProps) {
  const isIncluded = summary.includeInReport !== false;
  const current = getCurrentForTest(summaries, summary);
  const tests = getTestsForCurrent(summaries, summary.id);

  return (
    <div className="p-5 sm:p-8">
      <div className="flex flex-col gap-4 border-b border-border pb-6 pr-10 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {summary.clubName === "Unassigned" && (
              <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">
                <IconAlertTriangle className="h-3.5 w-3.5" />
                Unassigned
              </span>
            )}
            {!isIncluded && (
              <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                Excluded from report
              </span>
            )}
          </div>
          <ClubIdentityEditor
            batchId={batchId}
            summary={summary}
            onSaved={onIdentitySaved}
          />
        </div>
        <EstimatedPriceEditor
          batchId={batchId}
          summary={summary}
          onSaved={onPriceSaved}
        />
      </div>

      <section aria-label="Club summary metrics" className="py-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <DetailMetric
            key={`${summary.id}-carry`}
            label="Carry"
            value={summary.avgCarry}
            unit="yd"
            emphasis
          />
          <DetailMetric
            key={`${summary.id}-total`}
            label="Total"
            value={summary.avgTotal}
            unit="yd"
          />
          <DetailMetric
            key={`${summary.id}-ball`}
            label="Ball speed"
            value={summary.avgBallSpeed}
            unit="mph"
          />
          <DetailMetric
            key={`${summary.id}-club`}
            label="Club speed"
            value={summary.avgClubSpeed}
            unit="mph"
          />
          <DetailMetric
            key={`${summary.id}-spin`}
            label="Spin"
            value={summary.avgSpinRate}
            unit="rpm"
            decimals={0}
          />
          <DetailMetric
            key={`${summary.id}-height`}
            label="Max height"
            value={summary.avgMaxHeight}
            unit="yd"
          />
        </div>
      </section>

      <section aria-labelledby={`shot-review-heading-${summary.id}`}>
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border pb-3">
          <div>
            <h3
              id={`shot-review-heading-${summary.id}`}
              className="font-subheading text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              SHOTS
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Shot numbers follow the order of rows in the imported file.
            </p>
          </div>
          {shotData && shotData.shots.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {shotData.shots.filter((shot) => shot.included).length} of{" "}
              {shotData.shots.length} included
            </span>
          )}
        </div>

        {parserMode !== "trackman-result" ? (
          <p className="py-6 text-sm text-muted-foreground">
            Individual shot details are available for TrackMan imports.
          </p>
        ) : loading ? (
          <div
            className="flex items-center gap-3 py-8 text-sm text-muted-foreground"
            role="status"
          >
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
            Loading individual shots…
          </div>
        ) : error ? (
          <div className="flex flex-col items-start gap-3 py-6">
            <p className="text-sm text-muted-foreground" role="alert">
              {error}
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Try again
            </button>
          </div>
        ) : shotData?.shots.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            Individual shot review isn&apos;t available for this earlier import.
          </p>
        ) : shotData ? (
          <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[820px] border-collapse text-left">
              <caption className="sr-only">
                Individual shots for {summary.clubName}
              </caption>
              <thead>
                <tr className="border-b border-border bg-muted/40 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="sticky left-0 z-10 bg-muted px-4 py-2.5">
                    Shot
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right">Carry</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Total</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Ball speed</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Club speed</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Spin</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Max height</th>
                  <th scope="col" className="px-3 py-2.5">Status</th>
                  <th scope="col" className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shotData.shots.map((shot) => {
                  const saving = savingShotIds.has(shot.id);
                  return (
                    <tr key={shot.id} className="bg-card">
                      <th
                        scope="row"
                        className="sticky left-0 z-10 bg-card px-4 py-3 text-sm font-semibold tabular-nums text-foreground"
                      >
                        <span className={shot.included ? undefined : "opacity-60"}>
                          {shot.rowIndex + 1}
                        </span>
                      </th>
                      <ShotCell value={shotMetric(shot.carry)} unit="yd" muted={!shot.included} />
                      <ShotCell value={shotMetric(shot.total)} unit="yd" muted={!shot.included} />
                      <ShotCell value={shotMetric(shot.ballSpeed)} unit="mph" muted={!shot.included} />
                      <ShotCell value={shotMetric(shot.clubSpeed)} unit="mph" muted={!shot.included} />
                      <ShotCell value={shotMetric(shot.spinRate, 0)} unit="rpm" muted={!shot.included} />
                      <ShotCell value={shotMetric(shot.maxHeight)} unit="yd" muted={!shot.included} />
                      <td className="px-3 py-3">
                        <span
                          className={`inline-block rounded-full border px-2 py-1 text-[10px] font-semibold ${
                            shot.included
                              ? "border-primary/25 bg-primary/10 text-primary"
                              : "border-border bg-muted text-muted-foreground opacity-60"
                          }`}
                        >
                          {shot.included ? "Included" : "Excluded"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          disabled={saving}
                          aria-label={`${shot.included ? "Exclude" : "Include"} Shot ${shot.rowIndex + 1}`}
                          aria-busy={saving}
                          onClick={() =>
                            onShotInclusionChange(shot, !shot.included)
                          }
                          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-wait disabled:opacity-60 ${
                            shot.included
                              ? "border-border bg-card text-foreground hover:bg-muted"
                              : "border-primary bg-primary text-primary-foreground hover:bg-primary-hover"
                          }`}
                        >
                          {saving
                            ? shot.included
                              ? "Excluding…"
                              : "Including…"
                            : shot.included
                              ? "Exclude"
                              : "Include"}
                        </button>
                        {shotActionErrors[shot.id] && (
                          <p
                            className="mt-1.5 max-w-[14rem] whitespace-normal text-left text-xs text-red-700 dark:text-red-400"
                            role="alert"
                          >
                            {shotActionErrors[shot.id]}
                          </p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-6 text-sm text-muted-foreground" role="status">
            Preparing shot details…
          </div>
        )}
      </section>

      <div className="mt-7 border-t border-border pt-5">
        <ComparisonEditor
          summary={summary}
          summaries={summaries}
          current={current}
          tests={tests}
          onSaveTests={onSaveTests}
          onOpenSummary={onOpenSummary}
        />
      </div>

      <div className="mt-7 border-t border-border pt-5">
        <h3 className="font-subheading text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Club actions
        </h3>
        <div className="mt-3 grid grid-cols-1 gap-3">
          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <p className="text-sm font-medium text-foreground">Report inclusion</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {isIncluded
                ? "This club will be included when the fitting is finalized."
                : "This club is currently excluded from the report."}
            </p>
            <button
              type="button"
              role="switch"
              aria-checked={isIncluded}
              aria-label={`Include ${summary.clubName} in report`}
              disabled={isToggling}
              onClick={onToggleInclude}
              className={`relative mt-3 inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-55 ${
                isIncluded ? "bg-primary" : "bg-muted-foreground/35"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                  isIncluded ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
            {isToggling && (
              <span className="ml-2 text-xs text-muted-foreground" role="status">
                Saving…
              </span>
            )}
          </div>

        </div>

        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <span className="self-center px-2 text-xs text-muted-foreground">
            {summary.isManuallyEdited ? "Manually edited" : "TrackMan summary"}
          </span>
        </div>
      </div>
    </div>
  );
}

interface ComparisonEditorProps {
  summary: SerializedClubSummary;
  summaries: SerializedClubSummary[];
  current: SerializedClubSummary | null;
  tests: SerializedClubSummary[];
  onSaveTests: (
    currentSummaryId: number,
    testSummaryIds: number[],
  ) => Promise<SetCurrentTestsResponse>;
  onOpenSummary: (summaryId: number) => void;
}

function ComparisonEditor({
  summary,
  summaries,
  current,
  tests,
  onSaveTests,
  onOpenSummary,
}: ComparisonEditorProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmedIds = tests.map((test) => test.id).sort((a, b) => a - b);
  const confirmedKey = confirmedIds.join(",");
  const [selectionDraft, setSelectionDraft] = useState<{
    confirmedKey: string;
    ids: number[];
  }>(() => ({ confirmedKey, ids: confirmedIds }));
  const selectedIds =
    selectionDraft.confirmedKey === confirmedKey
      ? selectionDraft.ids
      : confirmedIds;

  if (current) {
    return (
      <ComparisonSection summaryId={summary.id}>
        <p className="mt-1 text-xs text-muted-foreground">
          This club is being compared against the customer&apos;s {current.clubName}.
        </p>
        <button
          type="button"
          onClick={() => onOpenSummary(current.id)}
          className="mt-2 text-xs font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          View comparison
        </button>
      </ComparisonSection>
    );
  }

  const candidates = summaries.filter((candidate) =>
    canSelectTest(summaries, summary.id, candidate.id),
  );
  const selectedKey = [...selectedIds].sort((a, b) => a - b).join(",");
  const hasChanges = selectedKey !== confirmedKey;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSaveTests(summary.id, [...selectedIds]);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save comparisons. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <ComparisonSection
      summaryId={summary.id}
      onClick={(event) => event.stopPropagation()}
      aside={
        tests.length > 0 ? (
          <span className="text-xs font-medium text-primary">
            Current · {tests.length} {tests.length === 1 ? "Test" : "Tests"}
          </span>
        ) : null
      }
    >
      <p className="mt-1 text-xs text-muted-foreground">
        Choose the clubs you want to compare against this club.
      </p>
      {candidates.length > 0 ? (
        <fieldset disabled={saving} className="mt-3 space-y-2">
          <legend className="sr-only">Choose test clubs</legend>
          {candidates.map((candidate) => {
            const existingCurrent = getCurrentForTest(summaries, candidate);
            return (
              <label
                key={candidate.id}
                className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm text-foreground hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(candidate.id)}
                  onChange={(event) => {
                    setSelectionDraft({
                      confirmedKey,
                      ids: event.target.checked
                        ? [...selectedIds, candidate.id]
                        : selectedIds.filter((id) => id !== candidate.id),
                    });
                    setError(null);
                  }}
                  className="mt-0.5 accent-primary"
                />
                <span className="min-w-0">
                  <span className="block truncate">{candidate.clubName}</span>
                  {candidate.tags.length > 0 && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {candidate.tags.join(", ")}
                    </span>
                  )}
                  {existingCurrent && existingCurrent.id !== summary.id && (
                    <span className="block text-xs text-muted-foreground">
                      Currently compared with {existingCurrent.clubName}; saving will move it.
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </fieldset>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          No eligible test clubs are available.
        </p>
      )}
      {error && (
        <p className="mt-3 text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={saving || !hasChanges}
          onClick={save}
          className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save comparison"}
        </button>
        {saving && (
          <span className="text-xs text-muted-foreground" role="status">
            Saving comparison…
          </span>
        )}
      </div>
    </ComparisonSection>
  );
}

function ComparisonSection({
  summaryId,
  aside,
  onClick,
  children,
}: {
  summaryId: number;
  aside?: ReactNode;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  children: ReactNode;
}) {
  const headingId = `comparison-heading-${summaryId}`;
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-xl border border-border bg-muted/30 p-4"
      onClick={onClick}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3
          id={headingId}
          className="font-subheading text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Comparison
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function EstimatedPriceEditor({
  batchId,
  summary,
  onSaved,
}: {
  batchId: number;
  summary: SerializedClubSummary;
  onSaved: (price: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(
    summary.estimatedPrice === null ? "" : String(summary.estimatedPrice),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function cancelEdit() {
    setValue(
      summary.estimatedPrice === null ? "" : String(summary.estimatedPrice),
    );
    setError(null);
    setEditing(false);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = value.trim();
    const price = trimmed === "" ? null : Number(trimmed);
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      setError("Enter a valid non-negative price or leave it blank.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/staff/imports/${batchId}/club-summaries/${summary.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ estimatedPrice: price }),
        },
      );
      const result = (await response.json()) as {
        success?: boolean;
        summary?: { estimatedPrice?: unknown };
        error?: string;
      };
      if (!response.ok || !result.success || !result.summary) {
        throw new Error(result.error ?? "Could not save the estimated price.");
      }
      const savedPrice =
        result.summary.estimatedPrice === null ||
        result.summary.estimatedPrice === undefined
          ? null
          : Number(result.summary.estimatedPrice);
      if (savedPrice !== null && !Number.isFinite(savedPrice)) {
        throw new Error("The saved price response was invalid. Please reload.");
      }
      setValue(savedPrice === null ? "" : String(savedPrice));
      setEditing(false);
      onSaved(savedPrice);
    } catch (saveError: unknown) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Network error — please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="shrink-0 rounded-xl border border-border bg-muted/40 px-4 py-3 sm:min-w-48">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Estimated price
      </p>
      {editing ? (
        <form
          className="mt-2"
          onSubmit={save}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !saving) {
              event.preventDefault();
              event.stopPropagation();
              cancelEdit();
            }
          }}
        >
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-sm text-muted-foreground">
              $
            </span>
            <input
              ref={inputRef}
              autoFocus
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              aria-label={`Estimated price for ${summary.clubName}`}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              disabled={saving}
              className="min-w-0 flex-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm tabular-nums text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
            />
          </div>
          {error && (
            <p className="mt-2 max-w-56 text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={saving}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-1 flex items-center gap-2">
          <p className="font-heading text-lg font-semibold tabular-nums text-foreground">
            {summary.estimatedPrice === null
              ? "—"
              : `$${summary.estimatedPrice.toFixed(2)}`}
          </p>
          <button
            type="button"
            onClick={() => {
              setValue(
                summary.estimatedPrice === null
                  ? ""
                  : String(summary.estimatedPrice),
              );
              setError(null);
              setEditing(true);
            }}
            className="rounded-md px-2 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Edit price
          </button>
        </div>
      )}
    </div>
  );
}

function DetailMetric({
  label,
  value,
  unit,
  decimals = 1,
  emphasis = false,
}: {
  label: string;
  value: number | null;
  unit: string;
  decimals?: number;
  emphasis?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  // Non-null only while a number tween is running; otherwise the server value renders.
  const [tweened, setTweened] = useState<number | null>(null);
  const previousRef = useRef(value);
  const shownRef = useRef(value);
  const pulseRef = useRef<HTMLSpanElement>(null);
  const valueRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const previous = previousRef.current;
    if (previous === value) return;
    previousRef.current = value;
    const from = shownRef.current;

    if (reduceMotion) {
      shownRef.current = value;
      return;
    }

    const controls: Array<{ stop: () => void }> = [];
    if (pulseRef.current) {
      controls.push(
        animate(pulseRef.current, { opacity: [0, 1, 0] }, {
          duration: 0.9,
          ease: "easeInOut",
        }),
      );
    }

    if (from !== null && value !== null) {
      controls.push(
        animate(from, value, {
          duration: 0.7,
          ease: "easeOut",
          onUpdate: (latest) => {
            shownRef.current = latest;
            setTweened(latest);
          },
          onComplete: () => {
            shownRef.current = value;
            setTweened(null);
          },
        }),
      );
    } else {
      shownRef.current = value;
      if (valueRef.current) {
        controls.push(
          animate(valueRef.current, { opacity: [0.2, 1] }, { duration: 0.5 }),
        );
      }
    }

    return () => controls.forEach((control) => control.stop());
  }, [value, reduceMotion]);

  const displayed = reduceMotion ? value : (tweened ?? value);
  const text =
    displayed === null
      ? "—"
      : decimals === 0
        ? Math.round(displayed).toLocaleString()
        : displayed.toFixed(decimals);

  return (
    <div
      className={`relative min-w-0 rounded-xl border p-3 ${
        emphasis
          ? "border-primary/25 bg-primary/[0.04]"
          : "border-border bg-muted/30"
      }`}
    >
      <span
        ref={pulseRef}
        aria-hidden="true"
        className="pointer-events-none absolute -inset-px rounded-xl border-2 border-accent opacity-0"
      />
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 truncate font-heading font-bold tabular-nums text-foreground ${
          emphasis ? "text-2xl" : "text-lg"
        }`}
      >
        <span ref={valueRef}>{text}</span>
        {text !== "—" && (
          <span className="ml-1 text-xs font-medium text-muted-foreground">
            {unit}
          </span>
        )}
      </p>
    </div>
  );
}

function ShotCell({
  value,
  unit,
  muted = false,
}: {
  value: string;
  unit: string;
  muted?: boolean;
}) {
  return (
    <td className="whitespace-nowrap px-3 py-3 text-right text-sm font-semibold tabular-nums text-foreground">
      <span className={muted ? "opacity-60" : undefined}>
        {value}
        {value !== "—" && (
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            {unit}
          </span>
        )}
      </span>
    </td>
  );
}
