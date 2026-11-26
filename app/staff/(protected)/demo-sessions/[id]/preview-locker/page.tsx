import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IconArrowLeft } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { getCustomerSession } from "@/lib/queries/customer-sessions";
import { getExistingPurchaseRequest } from "@/lib/queries/purchase-requests";
import {
  FittingPresentation,
  PurchaseRequestSubmitted,
} from "@/app/swing-locker/_components/FittingPresentation";

export const metadata: Metadata = {
  title: "Locker Preview — Staff",
  robots: { index: false, follow: false },
};

function safeBackHref(from: string | string[] | undefined): string {
  const raw = Array.isArray(from) ? from[0] : from;
  if (raw && /^\/staff\//.test(raw)) return raw;
  return "/staff/imports";
}

export default async function PreviewLockerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
  const sessionId = parseInt(id, 10);
  if (isNaN(sessionId)) notFound();

  const owner = await db.demoSession.findFirst({
    where: { id: sessionId, status: "finalized" },
    select: { clientId: true },
  });
  if (!owner) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-8">
        <p className="text-slate-500 font-body text-sm">
          Session not found or not yet finalized.
        </p>
      </div>
    );
  }

  const [session, existingRequest] = await Promise.all([
    getCustomerSession(owner.clientId, sessionId),
    getExistingPurchaseRequest(owner.clientId, sessionId),
  ]);
  if (!session) notFound();

  return (
    <div className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 sm:py-10 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Link
            href={safeBackHref(from)}
            className="inline-flex min-w-0 items-center gap-1.5 font-body text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <IconArrowLeft aria-hidden="true" className="h-4 w-4 shrink-0" />
            Back to Fitting Details
          </Link>
          <span className="shrink-0 rounded-full border border-border bg-card px-3 py-1 font-body text-xs font-semibold text-muted-foreground">
            Staff Preview
          </span>
        </div>
        <FittingPresentation
          session={session}
          purchaseAction={
            existingRequest ? (
              <PurchaseRequestSubmitted />
            ) : (
              <div className="mt-6">
                <button
                  type="button"
                  disabled
                  className="w-full cursor-not-allowed rounded-xl bg-emerald-600 px-5 py-3.5 font-body text-sm font-semibold text-white shadow-sm opacity-50"
                >
                  Request Purchase
                </button>
              </div>
            )
          }
        />
      </div>
    </div>
  );
}
