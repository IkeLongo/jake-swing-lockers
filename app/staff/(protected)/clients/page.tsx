import type { Metadata } from "next";
import { db } from "@/lib/db";
import { ClientsTable } from "./_components/ClientsTable";
import type { ClientRow } from "./_components/ClientsTable";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Clients — Jake Swing Lockers Staff",
  robots: { index: false, follow: false },
};

export default async function StaffClientsPage() {
  const raw = await db.golfClient.findMany({
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      createdAt: true,
      _count: { select: { demoSessions: true } },
      demoSessions: {
        orderBy: { demoDate: "desc" },
        take: 1,
        select: { demoDate: true },
      },
    },
  });

  const clients: ClientRow[] = raw.map((c) => ({
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    phone: c.phone,
    createdAt: c.createdAt.toISOString(),
    demoSessionCount: c._count.demoSessions,
    lastDemoDate: c.demoSessions[0]?.demoDate?.toISOString() ?? null,
  }));

  return (
    <>
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <Link
            href="/staff/dashboard"
            className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 font-body"
          >
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-heading">
            Clients
          </h1>
          <p className="mt-1 text-sm text-slate-500 font-body">
            Manage golfer profiles and demo history.
          </p>
        </div>
      </div>

      {/* ── Table (client component handles search + modals) ─────────────────── */}
      <ClientsTable initialClients={clients} />
    </>
  );
}
