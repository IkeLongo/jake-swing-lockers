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

const SESSION_STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-500",
  uploaded: "bg-blue-100 text-blue-700",
  reviewing: "bg-yellow-100 text-yellow-700",
  finalized: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
};

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
        className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 font-body"
      >
        ← Back to Clients
      </Link>

      {/* ── Profile card ───────────────────────────────────────────────────── */}
      <div className="mb-8 rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-heading">
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
                label="Demo Sessions"
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

      {/* ── Demo sessions ──────────────────────────────────────────────────── */}
      <h2 className="mb-4 text-base font-semibold text-slate-800 font-heading">
        Demo Sessions
      </h2>

      {client.demoSessions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-8 py-12 text-center">
          <p className="text-sm text-slate-400 font-body">
            No demo sessions for this client yet.
          </p>
          <Link
            href="/staff/demo-sessions/new"
            className="mt-4 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors font-body"
          >
            Create Demo Session
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
          <table className="min-w-full text-sm font-body">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                  Demo Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                  Status
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                  Clubs
                </th>
                <th className="hidden px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap sm:table-cell">
                  Est. Total
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {client.demoSessions.map((s) => {
                const batch = s.importBatches[0] ?? null;
                const clubCount = batch?.clubSummaries.length ?? 0;
                const estTotal = batch?.clubSummaries
                  .filter((cs) => cs.includeInReport)
                  .reduce(
                    (sum, cs) =>
                      sum + (cs.estimatedPrice ? Number(cs.estimatedPrice) : 0),
                    0,
                  ) ?? null;

                const statusStyle =
                  SESSION_STATUS_STYLES[s.status] ??
                  "bg-slate-100 text-slate-500";

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
                const actionLabel = batch ? "View Review →" : "Upload file →";

                return (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                      {demoDateStr}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${statusStyle}`}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600 tabular-nums">
                      {clubCount > 0 ? (
                        clubCount
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 text-right text-slate-600 tabular-nums sm:table-cell">
                      {estTotal && estTotal > 0 ? (
                        `$${estTotal.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={actionHref}
                        className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
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
      <dt className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd className="text-slate-700">
        {value ?? <span className="text-slate-300">—</span>}
      </dd>
    </div>
  );
}
