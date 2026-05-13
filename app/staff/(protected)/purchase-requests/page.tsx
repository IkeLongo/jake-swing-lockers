import type { Metadata } from "next";
import { listAllPurchaseRequests } from "@/lib/queries/purchase-requests";
import { PurchaseRequestsTable } from "./_components/PurchaseRequestsTable";

export const metadata: Metadata = {
  title: "Purchase Requests — Jake Swing Lockers Staff",
  robots: { index: false, follow: false },
};

export default async function PurchaseRequestsPage() {
  const requests = await listAllPurchaseRequests();

  return (
    <>
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-heading">
          Purchase Requests
        </h1>
        <p className="mt-1 text-sm text-slate-500 font-body">
          Customer purchase interest submissions from Swing Locker sessions.
        </p>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <PurchaseRequestsTable initialRequests={requests} />
    </>
  );
}
