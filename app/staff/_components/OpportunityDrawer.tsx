"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import Drawer from "@/app/_components/ui/Drawer";
import {
  IconAlertCircle,
  IconChevronRight,
  IconAlertTriangle,
  IconMail,
  IconPhone,
} from "@tabler/icons-react";

interface OpportunityData {
  opportunityId: string;
  customerName: string;
  primaryContact: {
    email: string | null;
    phone: string | null;
  };
  ghl: {
    stage: string | null;
    monetaryValue: number | null;
    unavailable: boolean;
  };
  sessions: Array<{
    id: number;
    demoDate: Date;
    status: string;
    currentClub: string | null;
    clientGoal: string | null;
    notes: string | null;
    clubCount: number;
    importBatchId: number | null;
    importBatchStatus: string | null;
    purchaseRequestIds: number[];
  }>;
  purchaseRequests: Array<{
    id: number;
    status: string;
    createdAt: Date;
    demoSessionId: number;
    subtotal: number;
  }>;
}

interface OpportunityDrawerProps {
  opportunityId: string | null;
  open: boolean;
  onClose: () => void;
}

const STAGE_LABELS: Record<string, string> = {
  demo: "Demo Submitted",
  "locker-sent": "Swing Locker Sent",
  engaged: "Engaged",
  considering: "Considering Purchase",
};

const PURCHASE_REQUEST_STATUS_LABELS: Record<string, string> = {
  new_request: "New Request",
  reviewing: "Reviewing",
  quote_sent: "Quote Sent",
  purchased: "Purchased",
  fulfilled: "Fulfilled",
  declined: "Declined",
  cancelled: "Cancelled",
};

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function getStatusBadgeClasses(status: string): string {
  switch (status) {
    case "draft":
      return "bg-muted text-muted-foreground";
    case "uploaded":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200";
    case "reviewing":
      return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-200";
    case "finalized":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200";
    case "failed":
      return "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function getRequestStatusBadgeClasses(status: string): string {
  switch (status) {
    case "new_request":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200";
    case "reviewing":
      return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-200";
    case "quote_sent":
      return "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200";
    case "purchased":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200";
    case "fulfilled":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200";
    case "declined":
      return "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200";
    case "cancelled":
      return "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export default function OpportunityDrawer({
  opportunityId,
  open,
  onClose,
}: OpportunityDrawerProps) {
  const [data, setData] = useState<OpportunityData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !opportunityId) {
      return;
    }

    let isMounted = true;

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      setData(null);

      try {
        const res = await fetch(`/api/staff/opportunities/${opportunityId}`);
        if (!res.ok) {
          if (res.status === 404) {
            throw new Error("Opportunity not found");
          }
          throw new Error("Failed to load opportunity details");
        }
        const result = await res.json();

        // Parse dates returned from API as strings
        const parsed: OpportunityData = {
          ...result,
          sessions: result.sessions.map((s: Record<string, unknown>) => ({
            ...s,
            demoDate: new Date(s.demoDate as string),
          })),
          purchaseRequests: result.purchaseRequests.map((r: Record<string, unknown>) => ({
            ...r,
            createdAt: new Date(r.createdAt as string),
          })),
        };

        if (isMounted) {
          setData(parsed);
          setLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      isMounted = false;
    };
  }, [open, opportunityId]);

  if (!open || !opportunityId) return null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Opportunity Details"
    >
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-center space-y-2">
            <div className="text-sm text-muted-foreground">Loading opportunity details...</div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 flex gap-3 dark:bg-red-900/20 dark:border-red-800">
          <IconAlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div className="text-sm text-red-700 dark:text-red-300">{error}</div>
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {/* ── Opportunity Header ────────────────────────────────────────── */}
          <div className="pb-6 border-b border-border">
            <h2 className="text-xl font-bold text-foreground font-heading mb-1">
              {data.customerName}
            </h2>
            <div className="text-sm text-muted-foreground font-body font-mono">
              {data.opportunityId}
            </div>
          </div>

          {/* ── GHL Warning (if unavailable) ──────────────────────────────── */}
          {data.ghl.unavailable && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 flex gap-3 dark:bg-yellow-900/20 dark:border-yellow-800">
              <IconAlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
              <div className="text-xs text-yellow-700 dark:text-yellow-300">
                GHL opportunity details are temporarily unavailable. Local session and request data is shown below.
              </div>
            </div>
          )}

          {/* ── Stage & Value ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-muted p-3">
              <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1 font-heading">
                Stage
              </div>
              <div className="text-sm font-bold text-foreground font-body">
                {data.ghl.stage
                  ? STAGE_LABELS[data.ghl.stage] || data.ghl.stage
                  : "Unknown"}
              </div>
            </div>
            <div className="rounded-lg bg-muted p-3">
              <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1 font-heading">
                Value
              </div>
              <div className="text-sm font-bold text-accent font-body">
                {data.ghl.monetaryValue !== null && data.ghl.monetaryValue !== undefined
                  ? formatPrice(data.ghl.monetaryValue)
                  : "—"}
              </div>
            </div>
          </div>

          {/* ── Contact Info ──────────────────────────────────────────────── */}
          {(data.primaryContact.email || data.primaryContact.phone) && (
            <div className="pb-6 border-b border-border">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 font-heading">
                Contact
              </h3>
              <div className="space-y-2">
                {data.primaryContact.email && (
                  <div className="flex items-center gap-2.5 text-sm text-foreground font-body">
                    <IconMail className="h-4 w-4 text-muted-foreground shrink-0" />
                    <a
                      href={`mailto:${data.primaryContact.email}`}
                      className="hover:underline"
                    >
                      {data.primaryContact.email}
                    </a>
                  </div>
                )}
                {data.primaryContact.phone && (
                  <div className="flex items-center gap-2.5 text-sm text-foreground font-body">
                    <IconPhone className="h-4 w-4 text-muted-foreground shrink-0" />
                    <a
                      href={`tel:${data.primaryContact.phone}`}
                      className="hover:underline"
                    >
                      {data.primaryContact.phone}
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Fitting Sessions ──────────────────────────────────────────── */}
          <div className="pb-6 border-b border-border">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 font-heading">
              Fitting Sessions ({data.sessions.length})
            </h3>
            {data.sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground font-body">No sessions</p>
            ) : (
              <div className="space-y-2">
                {data.sessions.map((session) => (
                  <div
                    key={session.id}
                    className="rounded-lg border border-border p-3 space-y-2 bg-card"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-foreground text-sm font-body">
                          Fitting #{session.id}
                        </div>
                        <div className="text-xs text-muted-foreground font-body">
                          {formatDate(session.demoDate)}
                        </div>
                      </div>
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide shrink-0 ${getStatusBadgeClasses(session.status)}`}
                      >
                        {session.status}
                      </span>
                    </div>

                    {session.currentClub && (
                      <div className="text-xs text-muted-foreground font-body">
                        <span className="font-semibold">Current:</span> {session.currentClub}
                      </div>
                    )}

                    {session.clientGoal && (
                      <div className="text-xs text-muted-foreground font-body">
                        <span className="font-semibold">Goal:</span> {session.clientGoal}
                      </div>
                    )}

                    <div className="text-xs text-muted-foreground font-body">
                      {session.clubCount > 0
                        ? `${session.clubCount} club${session.clubCount === 1 ? "" : "s"} tested`
                        : "No clubs tested"}
                    </div>

                    {session.importBatchId && (
                      <Link
                        href={`/staff/imports/${session.importBatchId}/map`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary-hover hover:underline transition-colors"
                      >
                        Review Fitting
                        <IconChevronRight className="h-3 w-3" />
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Purchase Requests ─────────────────────────────────────────── */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 font-heading">
              Purchase Requests ({data.purchaseRequests.length})
            </h3>
            {data.purchaseRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground font-body">No requests</p>
            ) : (
              <div className="space-y-2">
                {data.purchaseRequests.map((req) => (
                  <div
                    key={req.id}
                    className="rounded-lg border border-border p-3 space-y-2 bg-card"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="font-semibold text-foreground text-sm font-body">
                          Request #{req.id}
                        </div>
                        <div className="text-xs text-muted-foreground font-body">
                          {formatDate(req.createdAt)}
                        </div>
                      </div>
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide shrink-0 ${getRequestStatusBadgeClasses(req.status)}`}
                      >
                        {PURCHASE_REQUEST_STATUS_LABELS[req.status] || req.status}
                      </span>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <div className="text-sm font-bold text-foreground font-body">
                        {formatPrice(req.subtotal)}
                      </div>
                      <Link
                        href={`/staff/purchase-requests/${req.id}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary-hover hover:underline transition-colors"
                      >
                        View
                        <IconChevronRight className="h-3 w-3" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}
