import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getOpportunityPageRedirect } from "@/lib/imports/opportunity-page";
import { getStagedCustomerSummary } from "@/lib/imports/staged-customer-summary";
import { StagedFittingHeader } from "../../_components/StagedFittingHeader";
import { OpportunitySection } from "./_components/OpportunitySection";

export const metadata: Metadata = {
  title: "Opportunity — Jake Swing Lockers Staff",
  robots: { index: false, follow: false },
};

export default async function ImportOpportunityPage({
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
      parserMode: true,
      demoSessionId: true,
      customerResolution: true,
      selectedGolfClientId: true,
      proposedFirstName: true,
      proposedLastName: true,
      proposedEmail: true,
      proposedPhone: true,
      selectedGolfClient: {
        select: { firstName: true, lastName: true, email: true, phone: true },
      },
    },
  });
  if (!batch) notFound();

  const destination = getOpportunityPageRedirect(batch);
  if (destination) redirect(destination);

  return (
    <div>
      <StagedFittingHeader
        title="Opportunity"
        description="Choose which sales opportunity this fitting belongs to."
        customer={getStagedCustomerSummary(batch)}
      />
      <div className="w-full max-w-3xl">
        <OpportunitySection batchId={batch.id} />
      </div>
    </div>
  );
}