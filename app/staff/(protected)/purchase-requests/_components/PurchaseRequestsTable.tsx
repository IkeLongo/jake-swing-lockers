"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PurchaseRequestSummary } from "@/lib/queries/purchase-requests";
import {
  PURCHASE_REQUEST_STATUS_STYLES,
  PURCHASE_REQUEST_STATUSES,
  PURCHASE_REQUEST_STATUS_LABELS,
  getPurchaseRequestStatusLabel,
  toCanonicalPurchaseRequestStatus,
  type PurchaseRequestStatus,
} from "@/lib/purchase-request-status";

interface Props {
  initialRequests: PurchaseRequestSummary[];
}

interface RowDateDebug {
  rawSessionDateValueFromDb: string;
  serializedValuePassedToClient: string;
  browserTimezone: string;
  parsedJsDateIsoString: string;
  finalFormattedDisplayValue: string;
}

const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

function fmtDate(date: Date | string, utc = false): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(utc ? { timeZone: "UTC" } : {}),
  });
}

function formatSessionDateOnly(date: Date | string): string {
  const raw = typeof date === "string" ? date : date.toISOString();
  const match = ISO_DATE_PREFIX.exec(raw);

  if (!match) {
    return fmtDate(date, true);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Parse explicit Y/M/D parts so calendar dates don't shift across browser timezones.
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function PurchaseRequestsTable({ initialRequests }: Props) {
  const debugDatesEnabled = process.env.NEXT_PUBLIC_DEBUG_DATES === "true";
  const router = useRouter();
  const [requests, setRequests] = useState(initialRequests);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const dateDebugById = useMemo<Record<number, RowDateDebug>>(() => {
    if (!debugDatesEnabled) return {};

    const browserTimezone =
      Intl.DateTimeFormat().resolvedOptions().timeZone || "Unknown/Unresolved";

    return Object.fromEntries(
      requests.map((req) => {
        const serializedValuePassedToClient =
          req.dateDebug?.serializedDemoDateForClient ??
          (typeof req.demoDate === "string"
            ? req.demoDate
            : new Date(req.demoDate).toISOString());

        const parsed = new Date(req.demoDate);
        const parsedJsDateIsoString = Number.isNaN(parsed.getTime())
          ? "Invalid Date"
          : parsed.toISOString();

        const sessionDateSourceForDisplay =
          req.dateDebug?.rawDemoDateFromDb ?? serializedValuePassedToClient;
        const finalFormattedDisplayValue = formatSessionDateOnly(
          sessionDateSourceForDisplay
        );

        return [
          req.id,
          {
            rawSessionDateValueFromDb:
              req.dateDebug?.rawDemoDateFromDb ?? "(not provided)",
            serializedValuePassedToClient,
            browserTimezone,
            parsedJsDateIsoString,
            finalFormattedDisplayValue,
          },
        ];
      })
    );
  }, [debugDatesEnabled, requests]);

  useEffect(() => {
    if (!debugDatesEnabled || process.env.NODE_ENV === "production") return;

    for (const req of requests) {
      const debug = dateDebugById[req.id];
      if (!debug) continue;

      console.debug("[date-debug][client] purchase request row", {
        requestId: req.id,
        ...debug,
      });
    }
  }, [dateDebugById, debugDatesEnabled, requests]);

  async function handleStatusChange(
    requestId: number,
    newStatus: PurchaseRequestStatus
  ) {
    const request = requests.find((r) => r.id === requestId);
    if (!request) return;

    const currentStatus = toCanonicalPurchaseRequestStatus(request.status);
    if (newStatus === currentStatus) return;

    setUpdatingId(requestId);
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
        setStatusError(data.error ?? "Failed to update status.");
        return;
      }

      setRequests((prev) =>
        prev.map((r) =>
          r.id === requestId ? { ...r, status: newStatus } : r
        )
      );
      router.refresh();
    } catch {
      setStatusError("Network error while updating status.");
    } finally {
      setUpdatingId(null);
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
    <div className="flex flex-col gap-3">
      {statusError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5">
          <p className="font-body text-xs text-red-600">{statusError}</p>
        </div>
      )}
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
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {requests.map((req) => {
              const rowDateDebug = dateDebugById[req.id];

              return (
                <Fragment key={req.id}>
                  <tr className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {req.clientName}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatSessionDateOnly(
                        req.dateDebug?.rawDemoDateFromDb ?? req.demoDate
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-slate-600">
                      {req.itemCount}
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const canonicalStatus =
                          toCanonicalPurchaseRequestStatus(req.status) ?? "new_request";

                        return (
                          <select
                            value={canonicalStatus}
                            disabled={updatingId === req.id}
                            onChange={(e) => {
                              handleStatusChange(
                                req.id,
                                e.target.value as PurchaseRequestStatus
                              );
                            }}
                            className={`rounded-lg px-2.5 py-1 text-xs font-semibold border border-transparent cursor-pointer focus:ring-2 focus:ring-emerald-400 focus:outline-none disabled:opacity-50 transition-colors font-body ${
                              PURCHASE_REQUEST_STATUS_STYLES[canonicalStatus]
                            }`}
                          >
                            {PURCHASE_REQUEST_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {PURCHASE_REQUEST_STATUS_LABELS[s]}
                              </option>
                            ))}
                          </select>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                      {fmtDate(req.createdAt)}
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
                  {debugDatesEnabled && rowDateDebug ? (
                    <tr className="bg-amber-50/70">
                      <td colSpan={6} className="px-4 py-2">
                        <details>
                          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                            Date debug (request #{req.id})
                          </summary>
                          <div className="mt-2 grid gap-1 text-[11px] text-amber-900">
                            <div>
                              raw session date value from database/API: {rowDateDebug.rawSessionDateValueFromDb}
                            </div>
                            <div>
                              serialized value passed to client: {rowDateDebug.serializedValuePassedToClient}
                            </div>
                            <div>browser timezone: {rowDateDebug.browserTimezone}</div>
                            <div>parsed JS Date ISO string: {rowDateDebug.parsedJsDateIsoString}</div>
                            <div>final formatted display value: {rowDateDebug.finalFormattedDisplayValue}</div>
                          </div>
                        </details>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
    </div>
  );
}
