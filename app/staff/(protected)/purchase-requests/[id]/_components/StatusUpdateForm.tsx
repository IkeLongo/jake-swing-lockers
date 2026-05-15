"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  PURCHASE_REQUEST_STATUSES,
  PURCHASE_REQUEST_STATUS_LABELS,
  PURCHASE_REQUEST_STATUS_STYLES,
  type PurchaseRequestStatus,
  toCanonicalPurchaseRequestStatus,
} from "@/lib/purchase-request-status";

interface Props {
  requestId: number;
  initialStatus: string;
}

export function StatusUpdateForm({ requestId, initialStatus }: Props) {
  const [status, setStatus] = useState<PurchaseRequestStatus>(
    toCanonicalPurchaseRequestStatus(initialStatus) ?? "new_request"
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  async function handleChange(newStatus: PurchaseRequestStatus) {
    if (newStatus === status) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch(`/api/staff/purchase-requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        setStatus(newStatus);
        setSaved(true);
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <select
        value={status}
        disabled={saving}
        onChange={(e) => handleChange(e.target.value as PurchaseRequestStatus)}
        className={`rounded-lg px-3 py-2 text-sm font-semibold font-body border border-transparent cursor-pointer focus:ring-2 focus:ring-emerald-400 focus:outline-none disabled:opacity-50 transition-colors ${
          PURCHASE_REQUEST_STATUS_STYLES[status]
        }`}
      >
        {PURCHASE_REQUEST_STATUSES.map((s) => (
          <option key={s} value={s}>
            {PURCHASE_REQUEST_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      {saving && (
        <span className="font-body text-xs text-slate-400">Saving…</span>
      )}
      {!saving && saved && (
        <span className="font-body text-xs text-emerald-600">Saved</span>
      )}
    </div>
  );
}
