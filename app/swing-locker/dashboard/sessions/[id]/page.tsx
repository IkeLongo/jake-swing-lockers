import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import {
  SWING_LOCKER_SESSION_COOKIE,
  verifySwingLockerSessionToken,
} from "@/lib/auth/swing-locker-session";
import { getCustomerSession } from "@/lib/queries/customer-sessions";
import { getExistingPurchaseRequest } from "@/lib/queries/purchase-requests";
import {
  FittingPresentation,
  PurchaseRequestSubmitted,
} from "@/app/swing-locker/_components/FittingPresentation";
import { PurchaseRequestTrigger } from "./_components/PurchaseRequestTrigger";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SWING_LOCKER_SESSION_COOKIE)?.value;
  if (!token) redirect("/swing-locker/login");

  const result = verifySwingLockerSessionToken(token);
  if (!result.valid) redirect("/swing-locker/login");

  const { golfClientId } = result.payload;
  const { id: rawId } = await params;
  const sessionId = parseInt(rawId, 10);
  if (isNaN(sessionId)) notFound();

  const [session, existingRequest] = await Promise.all([
    getCustomerSession(golfClientId, sessionId),
    getExistingPurchaseRequest(golfClientId, sessionId),
  ]);
  if (!session) notFound();

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6">
          <Link
            href="/swing-locker/dashboard"
            className="font-body text-sm text-emerald-600 hover:text-emerald-800 underline underline-offset-2"
          >
            ← Back to Dashboard
          </Link>
        </div>
        <FittingPresentation
          session={session}
          purchaseAction={
            existingRequest ? (
              <PurchaseRequestSubmitted />
            ) : (
              <PurchaseRequestTrigger
                sessionId={session.id}
                clubs={session.clubs.map(({ id, clubType, brand, model, estimatedPrice }) => ({
                  id, clubType, brand, model, estimatedPrice,
                }))}
              />
            )
          }
        />
      </div>
    </main>
  );
}
