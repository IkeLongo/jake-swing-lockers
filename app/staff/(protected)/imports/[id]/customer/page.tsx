import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { IconArrowLeft } from "@tabler/icons-react";
import { db } from "@/lib/db";
import type { CustomerResolutionState } from "@/lib/imports/customer-resolution";
import { getCustomerPageRedirect } from "@/lib/imports/customer-workflow-routing";
import { CustomerResolutionSection } from "./_components/CustomerResolutionSection";

export const metadata: Metadata = {
  title: "Resolve Customer — Jake Swing Lockers Staff",
  robots: { index: false, follow: false },
};

export default async function ImportCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) notFound();
  const batchId = Number(id);
  if (!Number.isSafeInteger(batchId)) notFound();

  const batch = await db.importBatch.findUnique({
    where: { id: batchId },
    select: {
      id: true,
      originalFileName: true,
      parserMode: true,
      demoSessionId: true,
      trackmanPlayerName: true,
      trackmanPlayerEmail: true,
      customerResolution: true,
      selectedGolfClientId: true,
      proposedFirstName: true,
      proposedLastName: true,
      proposedEmail: true,
      proposedPhone: true,
      selectedGolfClient: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
    },
  });

  if (!batch) notFound();

  const destination = getCustomerPageRedirect(batch);
  if (destination) redirect(destination);

  const initialState: CustomerResolutionState = {
    customerResolution:
      batch.customerResolution === "existing" ||
      batch.customerResolution === "new"
        ? batch.customerResolution
        : null,
    selectedGolfClientId: batch.selectedGolfClientId,
    proposedFirstName: batch.proposedFirstName,
    proposedLastName: batch.proposedLastName,
    proposedEmail: batch.proposedEmail,
    proposedPhone: batch.proposedPhone,
  };

  return (
    <div className="max-w-3xl">
      <Link
        href="/staff/imports"
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <IconArrowLeft className="h-4 w-4" />
        Back to imports
      </Link>

      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground font-subheading">
          TrackMan fitting
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground font-heading">
          Who is this fitting for?
        </h1>
        <p className="mt-1 text-sm text-muted-foreground font-body">
          Confirm the customer associated with this TrackMan fitting.
        </p>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs font-body">
          <dt className="text-muted-foreground">File</dt>
          <dd className="min-w-0 truncate text-foreground">{batch.originalFileName}</dd>
          {batch.trackmanPlayerName && (
            <>
              <dt className="text-muted-foreground">Player</dt>
              <dd className="min-w-0 truncate text-foreground">{batch.trackmanPlayerName}</dd>
            </>
          )}
          {batch.trackmanPlayerEmail && (
            <>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="min-w-0 truncate text-foreground">{batch.trackmanPlayerEmail}</dd>
            </>
          )}
        </dl>
      </header>

      <CustomerResolutionSection
        batchId={batch.id}
        trackmanPlayerName={batch.trackmanPlayerName}
        trackmanPlayerEmail={batch.trackmanPlayerEmail}
        initialState={initialState}
        initialSelectedCustomer={batch.selectedGolfClient}
      />
    </div>
  );
}
