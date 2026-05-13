"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STATUSES = ["pending", "contacted", "completed", "cancelled"] as const;
type Status = (typeof STATUSES)[number];

const STATUS_STYLES: Record<Status, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  contacted: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-slate-100 text-slate-500",
};

interface Props {
  requestId: number;
  initialStatus: string;
}

export function StatusUpdateForm({ requestId, initialStatus }: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  async function handleChange(newStatus: string) {
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
        onChange={(e) => handleChange(e.target.value)}
        className={`rounded-lg px-3 py-2 text-sm font-semibold font-body border border-transparent cursor-pointer focus:ring-2 focus:ring-emerald-400 focus:outline-none disabled:opacity-50 transition-colors ${
          STATUS_STYLES[(status as Status) ?? "pending"]
        }`}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
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
