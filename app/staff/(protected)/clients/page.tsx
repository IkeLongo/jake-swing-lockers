import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getClientPurchaseRequestValues } from "@/lib/queries/client-values";
import { ClientsTable } from "./_components/ClientsTable";
import type { ClientRow } from "./_components/ClientsTable";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Clients — Jake Swing Lockers Staff",
  robots: { index: false, follow: false },
};

export default async function StaffClientsPage() {
  const [raw, purchaseRequestValues] = await Promise.all([
    db.golfClient.findMany({
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        _count: { select: { demoSessions: true } },
        demoSessions: {
          orderBy: { demoDate: "desc" },
          take: 1,
          select: { demoDate: true },
        },
      },
    }),
    getClientPurchaseRequestValues(),
  ]);

  const clients: ClientRow[] = raw.map((c) => ({
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    phone: c.phone,
    demoSessionCount: c._count.demoSessions,
    lastDemoDate: c.demoSessions[0]?.demoDate?.toISOString() ?? null,
    purchaseRequestValue: purchaseRequestValues.get(c.id) ?? 0,
  }));

  return (
    <>
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <Link
            href="/staff/dashboard"
            className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary-hover font-body transition-colors"
          >
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-foreground font-heading">
            Clients
          </h1>
          <p className="mt-1 text-sm text-muted-foreground font-body">
            Manage golfer profiles and demo history.
          </p>
        </div>
      </div>

      {/* ── Table (client component handles search + modals) ─────────────────── */}
      <ClientsTable initialClients={clients} />
    </>
  );
}
