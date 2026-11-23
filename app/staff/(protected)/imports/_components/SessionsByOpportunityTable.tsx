"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import DeleteSessionButton from "./DeleteSessionButton";

export interface SessionRow {
  id: number;
  status: string;
  demoDate: Date;
  accessInviteStatus: string | null;
  ghlOpportunityId: string | null;
  client: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  };
  importBatches: Array<{
    id: number;
    status: string;
    rowCount: number;
    clubSummaries: { id: number }[];
  }>;
}

interface SessionGroup {
  opportunityId: string | null;
  clientName: string;
  sessions: SessionRow[];
}

interface Props {
  sessions: SessionRow[];
}

function getClientName(client: SessionRow["client"]): string {
  return (
    [client.firstName, client.lastName].filter(Boolean).join(" ") ||
    client.email ||
    "Unknown Client"
  );
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatOpportunityLabel(opportunityId: string): string {
  if (!opportunityId) return "Unknown";
  return opportunityId.length > 8 ? opportunityId.substring(0, 8) : opportunityId;
}

function formatFittingSessionLabel(sessionId: number): string {
  return `Fitting #${sessionId}`;
}

function groupSessions(sessions: SessionRow[]): SessionGroup[] {
  const grouped = new Map<string | null, SessionRow[]>();

  for (const session of sessions) {
    const key = session.ghlOpportunityId || null;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(session);
  }

  const groups: SessionGroup[] = [];

  // Add assigned opportunities first
  for (const [oppId, sessionsForOpp] of Array.from(grouped.entries())) {
    if (oppId === null) continue;

    const clientName = getClientName(sessionsForOpp[0]!.client);
    groups.push({
      opportunityId: oppId,
      clientName,
      sessions: sessionsForOpp,
    });
  }

  // Add unassigned at the end
  if (grouped.has(null)) {
    groups.push({
      opportunityId: null,
      clientName: "Unassigned",
      sessions: grouped.get(null)!,
    });
  }

  return groups;
}

function OpportunityGroupHeader({
  group,
  isExpanded,
  onToggle,
}: {
  group: SessionGroup;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const isUnassigned = group.opportunityId === null;
  const displayId = isUnassigned
    ? undefined
    : formatOpportunityLabel(group.opportunityId!);

  return (
    <tr
      className="cursor-pointer select-none bg-muted hover:bg-muted/80 transition-colors"
      onClick={onToggle}
    >
      <td colSpan={6} className="px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="inline-block w-4 text-center font-semibold text-foreground">
            {isExpanded ? "▼" : "▶"}
          </span>
          <span className="font-semibold text-foreground">
            {isUnassigned ? "Unassigned Sessions" : group.clientName}
          </span>
          {displayId && (
            <span
              className="text-xs text-muted-foreground font-mono cursor-text"
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(group.opportunityId || "");
              }}
              title={`Full ID: ${group.opportunityId}\n(Click to copy)`}
            >
              #{displayId}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            ({group.sessions.length} {group.sessions.length === 1 ? "session" : "sessions"})
          </span>
        </div>
      </td>
    </tr>
  );
}

function SessionRow({ session }: { session: SessionRow }) {
  const fittingLabel = formatFittingSessionLabel(session.id);
  const demoDateStr = formatDate(session.demoDate);
  const latestBatch = session.importBatches[0] ?? null;
  const clubCount = latestBatch?.clubSummaries.length ?? 0;

  const getStatusBadgeClass = (status: string): string => {
    switch (status) {
      case "draft":
        return "bg-muted text-muted-foreground";
      case "uploaded":
        return "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200";
      case "reviewing":
        return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-200";
      case "finalized":
        return "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200";
      case "failed":
        return "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getAccessBadgeClass = (status: string | null): string => {
    switch (status) {
      case "pending":
        return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-200";
      case "sent":
        return "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200";
      case "failed":
        return "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getAccessLabel = (status: string | null): string => {
    switch (status) {
      case "pending":
        return "Pending";
      case "sent":
        return "Sent";
      case "failed":
        return "Failed";
      default:
        return "Not Sent";
    }
  };

  const actionHref = latestBatch
    ? `/staff/imports/${latestBatch.id}/map`
    : `/staff/demo-sessions/${session.id}/upload`;
  const actionLabel = latestBatch ? "Review →" : "Upload file →";

  return (
    <tr key={session.id} className="border-t border-border hover:bg-card/50 transition-colors">
      <td className="px-4 py-3">
        <span className="font-medium text-foreground">{fittingLabel}</span>
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
        {demoDateStr}
      </td>
      <td className="px-4 py-3">
        <span
          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${getStatusBadgeClass(session.status)}`}
        >
          {session.status}
        </span>
      </td>
      <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
        {clubCount > 0 ? clubCount : <span className="text-muted-foreground/50">—</span>}
      </td>
      <td className="px-4 py-3">
        {session.status === "finalized" ? (
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${getAccessBadgeClass(session.accessInviteStatus)}`}
          >
            {getAccessLabel(session.accessInviteStatus)}
          </span>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-5">
          <Link
            href={actionHref}
            className="text-sm font-medium text-primary hover:text-primary-hover hover:underline whitespace-nowrap transition-colors"
          >
            {actionLabel}
          </Link>
          <DeleteSessionButton
            sessionId={session.id}
            clientName={fittingLabel}
            demoDate={demoDateStr}
            status={session.status}
          />
        </div>
      </td>
    </tr>
  );
}

export default function SessionsByOpportunityTable({ sessions }: Props) {
  const groups = useMemo(() => groupSessions(sessions), [sessions]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string | null>>(
    new Set(groups.map((g) => g.opportunityId))
  );

  const toggleGroup = (opportunityId: string | null) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(opportunityId)) {
      newExpanded.delete(opportunityId);
    } else {
      newExpanded.add(opportunityId);
    }
    setExpandedGroups(newExpanded);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
      <table className="min-w-full text-sm font-body">
        <thead className="border-b border-border bg-muted">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
              Fitting Session
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
              Demo Date
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
              Status
            </th>
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
              Clubs
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
              Access
            </th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {groups.map((group) => (
            <React.Fragment key={group.opportunityId ?? "unassigned"}>
              <OpportunityGroupHeader
                group={group}
                isExpanded={expandedGroups.has(group.opportunityId)}
                onToggle={() => toggleGroup(group.opportunityId)}
              />
              {expandedGroups.has(group.opportunityId) &&
                group.sessions.map((session) => <SessionRow key={session.id} session={session} />)}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
