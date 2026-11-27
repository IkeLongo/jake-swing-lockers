import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { IconArrowLeft } from "@tabler/icons-react";
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
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 sm:py-10 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <Link
            href="/swing-locker/dashboard"
            className="inline-flex items-center gap-1.5 font-body text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <IconArrowLeft aria-hidden="true" className="h-4 w-4 shrink-0" />
            Back to My Swing Locker
          </Link>
        </div>
        <FittingPresentation
          session={session}
          purchaseAction={
            existingRequest ? (
              <PurchaseRequestSubmitted />
            ) : session.purchaseClubs.length > 0 ? (
              <PurchaseRequestTrigger
                sessionId={session.id}
                clubs={session.purchaseClubs}
              />
            ) : null
          }
        />
      </div>
    </main>
  );
}
