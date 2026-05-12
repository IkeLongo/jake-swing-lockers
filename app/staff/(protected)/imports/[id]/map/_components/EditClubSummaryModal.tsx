"use client";

import { useEffect, useRef, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SerializedClubSummary {
  id: number;
  importBatchId: number;
  originalClubName: string | null;
  clubName: string;
  shotCount: number;
  avgClubSpeed: number | null;
  avgBallSpeed: number | null;
  avgSpinRate: number | null;
  avgMaxHeight: number | null;
  avgCarry: number | null;
  avgTotal: number | null;
  validClubSpeedCount: number;
  validBallSpeedCount: number;
  validSpinRateCount: number;
  validMaxHeightCount: number;
  validCarryCount: number;
  validTotalCount: number;
  isManuallyEdited: boolean;
  includeInReport: boolean;
  /** Optional price entered during review; copied into DemoClubTest on finalization. */
  estimatedPrice: number | null;
}

interface Props {
  batchId: number;
  summary: SerializedClubSummary;
  onClose: () => void;
  onSaved: (updated: SerializedClubSummary) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function numToString(v: number | null): string {
  return v === null ? "" : String(v);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function EditClubSummaryModal({
  batchId,
  summary,
  onClose,
  onSaved,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [clubName, setClubName] = useState(summary.clubName);
  const [avgClubSpeed, setAvgClubSpeed] = useState(
    numToString(summary.avgClubSpeed),
  );
  const [avgBallSpeed, setAvgBallSpeed] = useState(
    numToString(summary.avgBallSpeed),
  );
  const [avgSpinRate, setAvgSpinRate] = useState(
    numToString(summary.avgSpinRate),
  );
  const [avgMaxHeight, setAvgMaxHeight] = useState(
    numToString(summary.avgMaxHeight),
  );
  const [avgCarry, setAvgCarry] = useState(numToString(summary.avgCarry));
  const [avgTotal, setAvgTotal] = useState(numToString(summary.avgTotal));
  const [estimatedPrice, setEstimatedPrice] = useState(
    numToString(summary.estimatedPrice),
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  function handleBackdropClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === dialogRef.current && !saving) onClose();
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (clubName.trim() === "") {
      setError("Club name cannot be blank.");
      return;
    }
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/staff/imports/${batchId}/club-summaries/${summary.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clubName: clubName.trim(),
            avgClubSpeed: avgClubSpeed === "" ? null : avgClubSpeed,
            avgBallSpeed: avgBallSpeed === "" ? null : avgBallSpeed,
            avgSpinRate: avgSpinRate === "" ? null : avgSpinRate,
            avgMaxHeight: avgMaxHeight === "" ? null : avgMaxHeight,
            avgCarry: avgCarry === "" ? null : avgCarry,
            avgTotal: avgTotal === "" ? null : avgTotal,
            estimatedPrice: estimatedPrice === "" ? null : estimatedPrice,
          }),
        },
      );

      const json = (await res.json()) as {
        success?: boolean;
        summary?: Record<string, unknown>;
        error?: string;
      };

      if (!res.ok || !json.success) {
        setError(json.error ?? "Save failed.");
        setSaving(false);
        return;
      }

      // The API returns Decimal fields serialized as strings from Prisma —
      // convert them back to numbers for the client state.
      const s = json.summary!;
      const toN = (v: unknown) =>
        v === null || v === undefined ? null : parseFloat(String(v));

      onSaved({
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
      });

      onClose();
    } catch {
      setError("Network error — please try again.");
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClick={handleBackdropClick}
      className="m-auto max-w-lg w-full rounded-2xl bg-white p-0 shadow-2xl backdrop:bg-black/40"
    >
      <form onSubmit={handleSave} noValidate>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-bold text-slate-900 font-heading">
            Edit Club Summary
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-slate-400 hover:text-slate-600 disabled:opacity-40 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-6 py-5">
          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 font-body">
              {error}
            </p>
          )}

          {/* Read-only info */}
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-body">
            <span className="font-semibold text-slate-700">Original name:</span>{" "}
            <span className="text-slate-500">
              {summary.originalClubName ?? (
                <span className="italic">none (was blank)</span>
              )}
            </span>
            <span className="ml-4 font-semibold text-slate-700">Shots:</span>{" "}
            <span className="text-slate-500">{summary.shotCount}</span>
          </div>

          {/* Club name */}
          <ModalField
            label="Club Name"
            id="clubName"
            type="text"
            value={clubName}
            onChange={setClubName}
            disabled={saving}
            hint="Used for display. Changing this does not affect the original source data."
          />

          <div className="grid grid-cols-2 gap-3">
            <ModalField
              label="Avg Club Speed (mph)"
              id="avgClubSpeed"
              type="number"
              value={avgClubSpeed}
              onChange={setAvgClubSpeed}
              disabled={saving}
              hint={`${summary.validClubSpeedCount}/${summary.shotCount} shots valid`}
            />
            <ModalField
              label="Avg Ball Speed (mph)"
              id="avgBallSpeed"
              type="number"
              value={avgBallSpeed}
              onChange={setAvgBallSpeed}
              disabled={saving}
              hint={`${summary.validBallSpeedCount}/${summary.shotCount} shots valid`}
            />
            <ModalField
              label="Avg Spin Rate (rpm)"
              id="avgSpinRate"
              type="number"
              value={avgSpinRate}
              onChange={setAvgSpinRate}
              disabled={saving}
              hint={`${summary.validSpinRateCount}/${summary.shotCount} shots valid`}
            />
            <ModalField
              label="Avg Max Height (yrd)"
              id="avgMaxHeight"
              type="number"
              value={avgMaxHeight}
              onChange={setAvgMaxHeight}
              disabled={saving}
              hint={`${summary.validMaxHeightCount}/${summary.shotCount} shots valid`}
            />
            <ModalField
              label="Avg Carry (yrd)"
              id="avgCarry"
              type="number"
              value={avgCarry}
              onChange={setAvgCarry}
              disabled={saving}
              hint={`${summary.validCarryCount}/${summary.shotCount} shots valid`}
            />
            <ModalField
              label="Avg Total (yrd)"
              id="avgTotal"
              type="number"
              value={avgTotal}
              onChange={setAvgTotal}
              disabled={saving}
              hint={`${summary.validTotalCount}/${summary.shotCount} shots valid`}
            />
          </div>

          <p className="text-xs text-slate-400 font-body">
            Leave a numeric field blank to store it as no data (—). Shot counts
            and valid counts are not editable.
          </p>

          {/* Estimated price */}
          <ModalField
            label="Estimated Price ($)"
            id="estimatedPrice"
            type="number"
            value={estimatedPrice}
            onChange={setEstimatedPrice}
            disabled={saving}
            hint="Optional. Must be a positive number if provided."
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors font-body"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50 transition-colors font-body"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

// ── Modal field helper ─────────────────────────────────────────────────────────

function ModalField({
  label,
  id,
  type,
  value,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  id: string;
  type: "text" | "number";
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 font-body"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        step={type === "number" ? "0.01" : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-300 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-200 disabled:opacity-50 font-body"
        placeholder="—"
      />
      {hint && (
        <p className="mt-0.5 text-xs text-slate-400 font-body">{hint}</p>
      )}
    </div>
  );
}
