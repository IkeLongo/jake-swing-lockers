"use client";

import { useState } from "react";
import Link from "next/link";
import type { PurchaseRequestSummary } from "@/lib/queries/purchase-requests";

const STATUSES = ["pending", "contacted", "completed", "cancelled"] as const;
type Status = (typeof STATUSES)[number];

const STATUS_STYLES: Record<Status, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  contacted: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-slate-100 text-slate-500",
};

interface Props {
  initialRequests: PurchaseRequestSummary[];
}

function fmtDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function PurchaseRequestsTable({ initialRequests }: Props) {
  const [requests, setRequests] = useState(initialRequests);
  const [updating, setUpdating] = useState<number | null>(null);

  async function handleStatusChange(id: number, newStatus: string) {
    setUpdating(id);
    try {
      const res = await fetch(`/api/staff/purchase-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        setRequests((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status: newStatus } : r))
        );
      }
    } finally {
      setUpdating(null);
    }
  }

  if (requests.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
        <p className="font-body text-sm text-slate-400">
          No purchase requests yet.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm font-body">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                Customer
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                Session Date
              </th>
              <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-500">
                Clubs
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                Submitted
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                Notes
              </th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {requests.map((req) => (
              <tr key={req.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 font-medium text-slate-900">
                  {req.clientName}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {fmtDate(req.demoDate)}
                </td>
                <td className="px-4 py-3 text-center text-slate-600">
                  {req.itemCount}
                </td>
                <td className="px-4 py-3">
                  <select
                    value={req.status}
                    disabled={updating === req.id}
                    onChange={(e) => handleStatusChange(req.id, e.target.value)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold border-0 cursor-pointer focus:ring-1 focus:ring-emerald-400 focus:outline-none disabled:opacity-50 ${
                      STATUS_STYLES[(req.status as Status) ?? "pending"]
                    }`}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                  {fmtDate(req.createdAt)}
                </td>
                <td className="px-4 py-3 text-slate-500 max-w-[200px] truncate">
                  {req.notes ?? <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/staff/purchase-requests/${req.id}`}
                    className="font-body text-xs font-semibold text-emerald-700 hover:text-emerald-900 whitespace-nowrap"
                  >
                    View →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
