"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PurchaseRequestEditableClub } from "@/lib/queries/purchase-requests";
import {
  PURCHASE_REQUEST_STATUSES,
  PURCHASE_REQUEST_STATUS_LABELS,
  PURCHASE_REQUEST_STATUS_STYLES,
  type PurchaseRequestStatus,
  isPurchaseRequestLockedStatus,
  toCanonicalPurchaseRequestStatus,
} from "@/lib/purchase-request-status";

interface Props {
  requestId: number;
  initialStatus: string;
  initialNotes: string | null;
  initialSelectedClubIds: number[];
  availableClubs: PurchaseRequestEditableClub[];
}

function fmtPrice(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function clubLabel(club: PurchaseRequestEditableClub): string {
  const parts = [club.clubType, club.brand, club.model].filter(Boolean);
  return parts.length > 0 ? parts.join(" — ") : "Club";
}

export function PurchaseRequestEditForm({
  requestId,
  initialStatus,
  initialNotes,
  initialSelectedClubIds,
  availableClubs,
}: Props) {
  const router = useRouter();

  const initialCanonical = toCanonicalPurchaseRequestStatus(initialStatus) ?? "new_request";
  const [backendStatus, setBackendStatus] = useState<PurchaseRequestStatus>(initialCanonical);
  const [status, setStatus] = useState<PurchaseRequestStatus>(initialCanonical);
  const [selectedClubIds, setSelectedClubIds] = useState<Set<number>>(
    new Set(initialSelectedClubIds)
  );
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const isLocked = isPurchaseRequestLockedStatus(backendStatus);
  const statusChanged = status !== backendStatus;
  const clubsChanged =
    selectedClubIds.size !== initialSelectedClubIds.length ||
    initialSelectedClubIds.some((id) => !selectedClubIds.has(id));
  const notesChanged = notes !== (initialNotes ?? "");

  const availableById = useMemo(
    () => new Map(availableClubs.map((club) => [club.id, club])),
    [availableClubs]
  );

  function toggleClub(id: number) {
    if (isLocked || saving || statusUpdating) return;
    setSelectedClubIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleStatusChange(newStatus: PurchaseRequestStatus) {
    if (newStatus === backendStatus) return;

    const previousStatus = status;
    setStatus(newStatus);
    setStatusUpdating(true);
    setStatusError(null);

    try {
      const res = await fetch(`/api/staff/purchase-requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!res.ok) {
        setStatus(previousStatus);
        setStatusError(data.error ?? "Failed to update status.");
        return;
      }

      setBackendStatus(newStatus);
      router.refresh();
    } catch {
      setStatus(previousStatus);
      setStatusError("Network error while updating status.");
    } finally {
      setStatusUpdating(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Allow saves for clubs/notes only if not locked; status is already updated separately.
    if (isLocked && (clubsChanged || notesChanged)) return;
    if (!clubsChanged && !notesChanged) return;

    setSaving(true);
    setSaved(false);
    setError(null);
    setWarnings([]);

    try {
      const selected = Array.from(selectedClubIds).filter((id) => availableById.has(id));
      const res = await fetch(`/api/staff/purchase-requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clubIds: selected,
          notes,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        warnings?: string[];
      };

      if (!res.ok) {
        setError(data.error ?? "Failed to save purchase request updates.");
        return;
      }

      setWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      setSaved(true);
      router.refresh();
    } catch {
      setError("Network error while saving purchase request updates.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {isLocked && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5">
          <p className="font-body text-xs text-amber-800">
            Club and request note edits are locked in final statuses. You can still update the
            request status if needed.
          </p>
        </div>
      )}

      <div>
        <label className="block font-body text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
          Status
        </label>
        <div className="flex items-center gap-2 max-w-3xs">
          <select
            value={status}
            disabled={statusUpdating}
            onChange={(e) => {
              handleStatusChange(e.target.value as PurchaseRequestStatus);
            }}
            className={`rounded-lg px-3 py-2 text-sm font-semibold font-body border border-transparent cursor-pointer focus:ring-2 focus:ring-emerald-400 focus:outline-none disabled:opacity-50 transition-colors flex-1 ${
              PURCHASE_REQUEST_STATUS_STYLES[status]
            }`}
          >
            {PURCHASE_REQUEST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PURCHASE_REQUEST_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          {statusUpdating && (
            <span className="font-body text-xs text-slate-500">Updating…</span>
          )}
        </div>
        {statusError && <p className="font-body text-xs text-red-600 mt-1">{statusError}</p>}
      </div>

      <div>
        <p className="block font-body text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Requested Clubs
        </p>
        {availableClubs.length === 0 ? (
          <p className="font-body text-sm text-slate-400">No clubs available for this session.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {availableClubs.map((club) => (
              <label
                key={club.id}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
                  selectedClubIds.has(club.id)
                    ? "border-emerald-300 bg-emerald-50"
                    : "border-slate-200 bg-white"
                } ${isLocked || saving ? "opacity-70 cursor-not-allowed" : "cursor-pointer hover:bg-slate-50"}`}
              >
                <input
                  type="checkbox"
                  checked={selectedClubIds.has(club.id)}
                  onChange={() => toggleClub(club.id)}
                  disabled={isLocked || saving}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span className="flex-1 font-body text-sm text-slate-800 leading-snug">
                  {clubLabel(club)}
                </span>
                {club.estimatedPrice != null && (
                  <span className="font-body text-sm font-semibold text-emerald-700 shrink-0">
                    {fmtPrice(club.estimatedPrice)}
                  </span>
                )}
              </label>
            ))}
          </div>
        )}
      </div>

      <div>
        <label className="block font-body text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
          Request Notes
        </label>
        <textarea
          value={notes}
          onChange={(e) => {
            setSaved(false);
            setNotes(e.target.value);
          }}
          disabled={isLocked || saving}
          rows={4}
          placeholder="Add or revise request notes"
          className="w-full rounded-xl border border-slate-200 px-4 py-2.5 font-body text-sm text-slate-800 placeholder-slate-400 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 focus:outline-none resize-none disabled:opacity-50"
        />
      </div>

      {error && <p className="font-body text-xs text-red-600">{error}</p>}
      {warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5">
          <p className="font-body text-xs font-semibold text-amber-900 mb-1">Saved with warnings</p>
          <ul className="list-disc pl-5 space-y-1">
            {warnings.map((warning, idx) => (
              <li key={idx} className="font-body text-xs text-amber-800">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={
            saving ||
            statusUpdating ||
            (clubsChanged === false && notesChanged === false) ||
            (isLocked && (clubsChanged || notesChanged)) ||
            (clubsChanged && selectedClubIds.size === 0)
          }
          className="rounded-lg bg-emerald-600 px-4 py-2 font-body text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
        {saved && !saving && <span className="font-body text-xs text-emerald-600">Saved</span>}
      </div>
    </form>
  );
}
