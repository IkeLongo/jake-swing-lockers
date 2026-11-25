import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getPurchaseRequestDetail,
  type PurchaseRequestDetailItem,
} from "@/lib/queries/purchase-requests";
import {
  PURCHASE_REQUEST_STATUS_STYLES,
  getPurchaseRequestStatusLabel,
  toCanonicalPurchaseRequestStatus,
} from "@/lib/purchase-request-status";
import { PurchaseRequestEditForm } from "./_components/PurchaseRequestEditForm";

export const metadata: Metadata = {
  title: "Purchase Request — Jake Swing Lockers Staff",
  robots: { index: false, follow: false },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function fmtPrice(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function fmtNum(value: number | null, decimals = 1): string {
  if (value == null) return "—";
  return value.toFixed(decimals);
}

function fmtPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

const SESSION_STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600 dark:bg-slate-900/30 dark:text-slate-300",
  uploaded: "bg-blue-100 text-blue-900 dark:bg-blue-950/50 dark:text-blue-200",
  reviewing: "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
  finalized: "bg-green-100 text-green-900 dark:bg-green-950/50 dark:text-green-200",
  failed: "bg-red-100 text-red-900 dark:bg-red-950/50 dark:text-red-200",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border bg-muted/50">
        <h2 className="font-subheading text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-4">
      <span className="font-body text-xs font-semibold uppercase tracking-wider text-muted-foreground w-28 shrink-0">
        {label}
      </span>
      <span className="font-body text-sm text-foreground">{value ?? <span className="text-muted-foreground">—</span>}</span>
    </div>
  );
}

function MetricPill({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex flex-col items-center rounded-lg bg-muted border border-border px-3 py-2 min-w-[72px]">
      <span className="font-body text-base font-bold text-foreground tabular-nums leading-none">
        {value}
        {unit && <span className="text-xs font-normal text-muted-foreground ml-0.5">{unit}</span>}
      </span>
      <span className="mt-1 font-body text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function ClubCard({ item }: { item: PurchaseRequestDetailItem }) {
  const nameParts = [item.clubType, item.brand, item.model].filter(Boolean);
  const displayName = nameParts.length > 0 ? nameParts.join(" — ") : "Club";

  const hasMetrics =
    item.clubSpeed != null ||
    item.ballSpeed != null ||
    item.spinRate != null ||
    item.carryDistance != null ||
    item.totalDistance != null;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
        <h3 className="font-heading text-sm font-semibold text-foreground">
          {displayName}
        </h3>
        {item.estimatedPrice != null && (
          <span className="shrink-0 font-body text-sm font-semibold text-green-900 bg-green-100 dark:bg-green-950/50 dark:text-green-200 rounded-lg px-3 py-1">
            {fmtPrice(item.estimatedPrice)}
          </span>
        )}
      </div>

      <div className="px-5 py-4">
        {hasMetrics ? (
          <div className="flex flex-wrap gap-2">
            <MetricPill label="Club Spd" value={fmtNum(item.clubSpeed)} unit="mph" />
            <MetricPill label="Ball Spd" value={fmtNum(item.ballSpeed)} unit="mph" />
            <MetricPill
              label="Spin"
              value={item.spinRate != null ? String(item.spinRate) : "—"}
              unit="rpm"
            />
            <MetricPill label="Carry" value={fmtNum(item.carryDistance, 0)} unit="yds" />
            <MetricPill label="Total" value={fmtNum(item.totalDistance, 0)} unit="yds" />
          </div>
        ) : (
          <p className="font-body text-sm text-muted-foreground">No metrics recorded.</p>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function PurchaseRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) notFound();

  const request = await getPurchaseRequestDetail(id);
  if (!request) notFound();

  const { client, demoSession, items, estimatedSubtotal } = request;
  const canonicalStatus = toCanonicalPurchaseRequestStatus(request.status);
  const clientName =
    [client.firstName, client.lastName].filter(Boolean).join(" ") ||
    client.email ||
    `Client #${request.golfClientId}`;

  return (
    <>
      {/* ── Back link ───────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <Link
          href="/staff/purchase-requests"
          className="font-body text-sm text-primary hover:text-primary-hover underline underline-offset-2"
        >
          ← Back to Purchase Requests
        </Link>
      </div>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground font-heading">
            Purchase Request
          </h1>
          <p className="mt-1 font-body text-sm text-muted-foreground">
            Submitted {fmtDate(request.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`rounded-lg px-3 py-1 text-xs font-semibold font-body ${
              canonicalStatus
                ? PURCHASE_REQUEST_STATUS_STYLES[canonicalStatus]
                : "bg-muted text-muted-foreground"
            }`}
          >
            {getPurchaseRequestStatusLabel(request.status)}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-5">
        {/* ── Customer ──────────────────────────────────────────────────────── */}
        <SectionCard title="Customer">
          <div className="flex flex-col gap-2.5">
            <DetailRow label="Name" value={clientName} />
            <DetailRow label="Email" value={client.email} />
            <DetailRow label="Phone" value={fmtPhone(client.phone)} />
          </div>
        </SectionCard>

        {/* ── Fitting Session ──────────────────────────────────────────────── */}
        <SectionCard title="Fitting Session">
          <div className="flex flex-col gap-2.5">
            <DetailRow label="Date" value={fmtDate(demoSession.demoDate)} />
            <DetailRow
              label="Status"
              value={
                <span
                  className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold font-body ${
                    SESSION_STATUS_STYLES[demoSession.status] ?? "bg-muted text-muted-foreground"
                  }`}
                >
                  {demoSession.status}
                </span>
              }
            />
            <DetailRow
              label="Fitting"
              value={
                <Link
                  href={`/staff/imports`}
                  className="font-body text-sm text-primary hover:text-primary-hover underline underline-offset-2"
                >
                  View Fitting →
                </Link>
              }
            />
          </div>
        </SectionCard>

        {/* ── Requested Clubs ───────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="h-3.5 w-0.5 rounded-full bg-primary shrink-0" />
            <h2 className="font-subheading text-base font-semibold text-foreground">
              Requested Clubs
            </h2>
          </div>

          {items.length === 0 ? (
            <div className="rounded-xl border border-border bg-card px-6 py-8 text-center shadow-sm">
              <p className="font-body text-sm text-muted-foreground">No clubs recorded.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {items.map((item) => (
                <ClubCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>

        {/* ── Pricing summary ───────────────────────────────────────────────── */}
        {estimatedSubtotal != null && (
          <div className="rounded-xl border border-green-200 bg-green-100 dark:border-green-900/30 dark:bg-green-950/20 px-5 py-4 flex items-center justify-between shadow-sm">
            <p className="font-body text-sm font-semibold text-green-900 dark:text-green-200">
              Estimated Subtotal
            </p>
            <p className="font-heading text-xl font-bold text-green-900 dark:text-green-200 tabular-nums">
              {fmtPrice(estimatedSubtotal)}
            </p>
          </div>
        )}

        {/* ── Customer Notes ────────────────────────────────────────────────── */}
        <SectionCard title="Customer Notes">
          {request.notes ? (
            <p className="font-body text-sm text-foreground leading-relaxed whitespace-pre-wrap">
              {request.notes}
            </p>
          ) : (
            <p className="font-body text-sm text-muted-foreground">No notes provided.</p>
          )}
        </SectionCard>

        {/* ── Edit request ──────────────────────────────────────────────────── */}
        <SectionCard title="Edit Request">
          <p className="font-body text-xs text-muted-foreground mb-3">
            Update requested clubs, notes, and status from this detail view.
          </p>
          <PurchaseRequestEditForm
            requestId={request.id}
            initialStatus={request.status}
            initialNotes={request.notes}
            initialSelectedClubIds={request.items.map((item) => item.demoClubTestId)}
            availableClubs={request.availableClubs}
          />
        </SectionCard>
      </div>
    </>
  );
}
