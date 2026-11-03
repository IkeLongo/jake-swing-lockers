import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getOpportunityPageRedirect } from "@/lib/imports/opportunity-page";
import {
  GHL_APPROVAL_BATCH_SELECT,
  getCurrentGhlDecision,
} from "@/lib/imports/ghl-approval-gate";
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
      ...GHL_APPROVAL_BATCH_SELECT,
      selectedGolfClient: {
        select: { firstName: true, lastName: true, email: true, phone: true },
      },
    },
  });
  if (!batch) notFound();

  const destination = getOpportunityPageRedirect(
    batch,
    getCurrentGhlDecision(batch, batch.selectedGolfClient),
  );
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