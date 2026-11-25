import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import DeleteClientButton from "../_components/DeleteClientButton";

// TODO: customer OTP login — when built, link the swing locker token from here
// TODO: GHL contact sync — show GHL sync status on client profile

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const client = await db.golfClient.findUnique({
    where: { id: parseInt(id, 10) },
    select: { firstName: true, lastName: true },
  });
  const name =
    [client?.firstName, client?.lastName].filter(Boolean).join(" ") ||
    "Client";
  return {
    title: `${name} — Jake Swing Lockers Staff`,
    robots: { index: false, follow: false },
  };
}

function fmtPhone(phone: string | null): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  const ten =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length === 10) {
    return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  }
  return phone;
}

// Match Fitting History status badge styling
const SESSION_STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  uploaded: "bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-200",
  reviewing: "bg-yellow-100 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-200",
  finalized: "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-200",
  failed: "bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-200",
};

// Reuse fitting value calculation logic from Fitting History page
function calculateClubCountAndValue(
  clubSummaries: Array<{ includeInReport: boolean | null; estimatedPrice: string | number | null }>
): { clubCount: number; fittingValue: { total: number; hasAnyPrice: boolean; hasPartialPrice: boolean } } {
  const includedClubs = clubSummaries.filter((club) => club.includeInReport !== false);
  
  const clubCount = includedClubs.length;

  let totalPrice = 0;
  let clubsWithPrice = 0;

  for (const club of includedClubs) {
    if (club.estimatedPrice !== null) {
      const price = typeof club.estimatedPrice === 'string' 
        ? parseFloat(club.estimatedPrice) 
        : Number(club.estimatedPrice);
      totalPrice += price;
      clubsWithPrice++;
    }
  }

  const hasAnyPrice = clubsWithPrice > 0;
  const hasPartialPrice = hasAnyPrice && clubsWithPrice < includedClubs.length;
  const fittingValue = { total: totalPrice, hasAnyPrice, hasPartialPrice };

  return { clubCount, fittingValue };
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) notFound();

  const client = await db.golfClient.findUnique({
    where: { id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      createdAt: true,
      demoSessions: {
        orderBy: { demoDate: "desc" },
        select: {
          id: true,
          status: true,
          demoDate: true,
          importBatches: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              clubSummaries: {
                select: {
                  estimatedPrice: true,
                  includeInReport: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!client) notFound();

  const clientName =
    [client.firstName, client.lastName].filter(Boolean).join(" ") ||
    client.email ||
    `Client #${client.id}`;

  return (
    <>
      {/* ── Back link ──────────────────────────────────────────────────────── */}
      <Link
        href="/staff/clients"
        className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary-hover hover:underline font-body transition-colors"
      >
        ← Back to Clients
      </Link>

      {/* ── Profile card ───────────────────────────────────────────────────── */}
      <div className="mb-8 rounded-xl border border-border bg-card p-6 shadow-xs">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground font-heading">
              {clientName}
            </h1>
            <dl className="mt-3 grid grid-cols-1 gap-y-1.5 text-sm font-body sm:grid-cols-2 sm:gap-x-6">
              <ProfileField label="Email" value={client.email} />
              <ProfileField label="Phone" value={fmtPhone(client.phone)} />
              <ProfileField
                label="Created"
                value={new Date(client.createdAt).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              />
              <ProfileField
                label="Fittings"
                value={String(client.demoSessions.length)}
              />
            </dl>
          </div>
          {/* TODO: merge duplicate clients — future feature */}
          <DeleteClientButton
            clientId={client.id}
            clientName={clientName}
            email={client.email}
            phone={client.phone}
            phoneFmt={fmtPhone(client.phone)}
            demoSessionCount={client.demoSessions.length}
          />
        </div>
      </div>

      {/* ── Fitting History ─────────────────────────────────────────────────── */}
      <h2 className="mb-4 text-base font-semibold text-foreground font-heading">
        Fitting History
      </h2>

      {client.demoSessions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted px-8 py-12 text-center">
          <p className="text-sm text-muted-foreground/60 font-body">
            No fittings for this client yet.
          </p>
          <Link
            href="/staff/demo-sessions/new"
            className="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover transition-colors font-body"
          >
            Create Fitting
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
          <table className="min-w-full text-sm font-body">
            <thead className="border-b border-border bg-muted">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                  Fitting Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                  Status
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                  Clubs
                </th>
                <th className="hidden px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap sm:table-cell">
                  Value
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {client.demoSessions.map((s) => {
                const batch = s.importBatches[0] ?? null;
                const { clubCount, fittingValue } = batch
                  ? calculateClubCountAndValue(
                      batch.clubSummaries.map((cs) => ({
                        includeInReport: cs.includeInReport,
                        estimatedPrice: cs.estimatedPrice ? cs.estimatedPrice.toString() : null,
                      }))
                    )
                  : { clubCount: 0, fittingValue: { total: 0, hasAnyPrice: false, hasPartialPrice: false } };

                const statusStyle =
                  SESSION_STATUS_STYLES[s.status] ??
                  "bg-muted text-muted-foreground";

                const demoDateStr = new Date(s.demoDate).toLocaleDateString(
                  "en-US",
                  {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    timeZone: "UTC",
                  },
                );

                // Best available view link: import review if batch exists, else upload
                const actionHref = batch
                  ? `/staff/imports/${batch.id}/map`
                  : `/staff/demo-sessions/${s.id}/upload`;
                const actionLabel = s.status === "finalized" ? "View Fitting →" : "View Review →";

                return (
                  <tr key={s.id} className="border-t border-border hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                      {demoDateStr}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${statusStyle}`}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                      {clubCount > 0 ? (
                        clubCount
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 text-right text-muted-foreground tabular-nums sm:table-cell">
                      {fittingValue.hasAnyPrice ? (
                        <>
                          <span className={fittingValue.hasPartialPrice ? "opacity-70" : ""}>
                            ${fittingValue.total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                          {fittingValue.hasPartialPrice && (
                            <span
                              title="Some included clubs don't have price estimates"
                              className="ml-1 text-muted-foreground/50 cursor-help"
                            >
                              *
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={actionHref}
                        className="text-xs font-semibold text-primary hover:text-primary-hover hover:underline whitespace-nowrap transition-colors"
                      >
                        {actionLabel}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── Profile field helper ──────────────────────────────────────────────────────

function ProfileField({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-foreground">
        {value ?? <span className="text-muted-foreground/50">—</span>}
      </dd>
    </div>
  );
}
