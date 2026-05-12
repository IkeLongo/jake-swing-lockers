"use client";

import { useState } from "react";
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
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ClubSummarySection({ batchId, initialSummaries, parserMode }: Props) {
  const [summaries, setSummaries] =
    useState<SerializedClubSummary[]>(initialSummaries);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  // IDs currently awaiting a PATCH toggle response
  const [toggling, setToggling] = useState<Set<number>>(new Set());
  const [toggleError, setToggleError] = useState<string | null>(null);

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
        }),
      );

      setSummaries(normalized);
    } catch {
      setGenerateError("Network error — please try again.");
    } finally {
      setGenerating(false);
    }
  }

  function handleSaved(updated: SerializedClubSummary) {
    setSummaries((prev) =>
      prev.map((s) => (s.id === updated.id ? updated : s)),
    );
  }

  async function handleToggleInclude(id: number, currentIncluded: boolean) {
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

      {/* ── Club summary table ──────────────────────────────────────────────── */}
      {hasSummaries && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
          <table className="w-full min-w-[1500px] text-sm font-body">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="min-w-[90px] whitespace-nowrap px-5 py-3 font-subheading text-center">Include</th>
                <th className="min-w-[140px] whitespace-nowrap px-5 py-3 font-subheading">Club</th>
                <th className="min-w-[90px] whitespace-nowrap px-5 py-3 font-subheading text-center">Shots</th>
                <th className="min-w-[160px] whitespace-nowrap px-5 py-3 font-subheading text-right">Avg Club Speed</th>
                <th className="min-w-[160px] whitespace-nowrap px-5 py-3 font-subheading text-right">Avg Ball Speed</th>
                <th className="min-w-[150px] whitespace-nowrap px-5 py-3 font-subheading text-right">Avg Spin</th>
                <th className="min-w-[150px] whitespace-nowrap px-5 py-3 font-subheading text-right">Avg Height</th>
                <th className="min-w-[150px] whitespace-nowrap px-5 py-3 font-subheading text-right">Avg Carry</th>
                <th className="min-w-[150px] whitespace-nowrap px-5 py-3 font-subheading text-right">Avg Total</th>
                <th className="min-w-[100px] whitespace-nowrap px-5 py-3 font-subheading text-center">Edited</th>
                <th className="min-w-[120px] whitespace-nowrap px-5 py-3 font-subheading">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summaries.map((s) => {
                // Treat null/undefined as true (included) — defensive guard
                // against stale cache or missing field on old records.
                const isIncluded = s.includeInReport !== false;
                const isToggling = toggling.has(s.id);
                return (
                  <tr
                    key={s.id}
                    className={`transition-colors ${
                      !isIncluded
                        ? "bg-slate-200/60 opacity-50 grayscale"
                        : "hover:bg-slate-50/60"
                    }`}
                  >
                    {/* Include toggle */}
                    <td className="whitespace-nowrap px-5 py-4 text-center">
                      <button
                        role="switch"
                        aria-checked={isIncluded}
                        disabled={isToggling}
                        onClick={() =>
                          handleToggleInclude(s.id, isIncluded)
                        }
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-wait ${
                          isIncluded
                            ? "bg-emerald-500"
                            : "bg-slate-300"
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                            isIncluded
                              ? "translate-x-4"
                              : "translate-x-0"
                          }`}
                        />
                      </button>
                      {!isIncluded && (
                        <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          Excluded
                        </div>
                      )}
                    </td>
                    {/* Club */}
                    <td className="whitespace-nowrap px-5 py-4">
                      {s.clubName === "Unassigned" ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-yellow-300 bg-yellow-50 px-2 py-0.5 text-xs font-semibold text-yellow-700">
                          ⚠ Unassigned
                        </span>
                      ) : (
                        <span className="font-medium text-slate-800">
                          {s.clubName}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-center text-slate-600">
                      {s.shotCount}
                    </td>
                    <MetricCell
                      value={fmt(s.avgClubSpeed)}
                      valid={s.validClubSpeedCount}
                      total={s.shotCount}
                      unit="mph"
                    />
                    <MetricCell
                      value={fmt(s.avgBallSpeed)}
                      valid={s.validBallSpeedCount}
                      total={s.shotCount}
                      unit="mph"
                    />
                    <MetricCell
                      value={fmtInt(s.avgSpinRate)}
                      valid={s.validSpinRateCount}
                      total={s.shotCount}
                      unit="rpm"
                    />
                    <MetricCell
                      value={fmt(s.avgMaxHeight)}
                      valid={s.validMaxHeightCount}
                      total={s.shotCount}
                      unit="yrd"
                    />
                    <MetricCell
                      value={fmt(s.avgCarry)}
                      valid={s.validCarryCount}
                      total={s.shotCount}
                      unit="yrd"
                    />
                    <MetricCell
                      value={fmt(s.avgTotal)}
                      valid={s.validTotalCount}
                      total={s.shotCount}
                      unit="yrd"
                    />
                    <td className="whitespace-nowrap px-5 py-4 text-center">
                      {s.isManuallyEdited ? (
                        <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200">
                          Edited
                        </span>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4">
                      <button
                        onClick={() => setEditingId(s.id)}
                        className="rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Confirm placeholder ─────────────────────────────────────────────── */}
      {hasSummaries && (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-5 shadow-xs">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-700 font-subheading">
                Ready to confirm?
              </p>
              <p className="mt-0.5 text-xs text-slate-500 font-body">
                Review and edit club averages above, then confirm to proceed.
                Only included club summaries will be used in the future Swing
                Locker/report.{" "}
                {/* TODO: filter by includeInReport === true when final import/report generation is implemented */}
              </p>
            </div>
            <button
              disabled
              title="Coming soon — final import into golf records will be implemented next."
              className="shrink-0 rounded-lg bg-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-400 cursor-not-allowed font-body"
            >
              Confirm Club Summaries
            </button>
          </div>
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
