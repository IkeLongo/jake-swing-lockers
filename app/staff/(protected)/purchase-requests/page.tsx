import type { Metadata } from "next";
import Link from "next/link";
import { listAllPurchaseRequests } from "@/lib/queries/purchase-requests";
import { PurchaseRequestsTable } from "./_components/PurchaseRequestsTable";

export const metadata: Metadata = {
  title: "Purchase Requests — Jake Swing Lockers Staff",
  robots: { index: false, follow: false },
};

export default async function PurchaseRequestsPage() {
  const debugDatesEnabled = process.env.NEXT_PUBLIC_DEBUG_DATES === "true";
  const requests = await listAllPurchaseRequests();
  const requestsForClient = requests.map((request) => {
    const serializedDemoDateForClient = new Date(request.demoDate).toISOString();

    if (debugDatesEnabled && process.env.NODE_ENV !== "production") {
      console.debug("[date-debug][server->client] purchase request row", {
        requestId: request.id,
        rawDemoDateFromDb: request.dateDebug?.rawDemoDateFromDb ?? null,
        serializedDemoDateForClient,
      });
    }

    return {
      ...request,
      ...(debugDatesEnabled
        ? {
            dateDebug: {
              ...(request.dateDebug ?? { rawDemoDateFromDb: serializedDemoDateForClient }),
              serializedDemoDateForClient,
            },
          }
        : {}),
    };
  });

  return (
    <>
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="mb-8">
        <Link
          href="/staff/dashboard"
          className="mb-6 underline inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 font-body"
        >
          ← Back to Dashboard
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-heading">
          Purchase Requests
        </h1>
        <p className="mt-1 text-sm text-slate-500 font-body">
          Customer purchase interest submissions from Swing Locker sessions.
        </p>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <PurchaseRequestsTable initialRequests={requestsForClient} />
    </>
  );
}
