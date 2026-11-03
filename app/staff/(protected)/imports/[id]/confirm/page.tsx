import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { STAFF_SESSION_COOKIE, verifyStaffSessionToken } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getOpportunityById } from "@/lib/ghl/opportunities";
import {
  formatFittingDate,
  getConfirmClubs,
  getConfirmPageRedirect,
  getConfirmPageState,
} from "@/lib/imports/confirm-page";
import { formatOpportunityMeta, normalizeOpportunityCreatedAt } from "@/lib/imports/opportunity-page";
import { getStagedCustomerSummary } from "@/lib/imports/staged-customer-summary";
import { StagedFittingHeader } from "../../_components/StagedFittingHeader";
import { ConfirmActions } from "./_components/ConfirmActions";

export const metadata: Metadata = {
  title: "Confirm Fitting — Jake Swing Lockers Staff",
  robots: { index: false, follow: false },
};

const sectionHeading =
  "text-xs font-semibold uppercase tracking-wide text-muted-foreground font-subheading";

export default async function ImportConfirmPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) notFound();
  const batchId = Number(id);
  if (!Number.isSafeInteger(batchId)) notFound();

  const [batch, summaries] = await Promise.all([
    db.importBatch.findUnique({
      where: { id: batchId },
      select: {
        id: true,
        parserMode: true,
        status: true,
        demoSessionId: true,
        customerResolution: true,
        selectedGolfClientId: true,
        proposedFirstName: true,
        proposedLastName: true,
        proposedEmail: true,
        proposedPhone: true,
        opportunityResolution: true,
        selectedGhlOpportunityId: true,
        trackmanSessionDate: true,
        selectedGolfClient: {
          select: { firstName: true, lastName: true, email: true, phone: true },
        },
        demoSession: {
          select: {
            status: true,
            demoDate: true,
            salesRep: true,
            ghlOpportunityId: true,
            ghlSyncStatus: true,
            ghlSyncError: true,
            client: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
              },
            },
          },
        },
      },
    }),
    db.importClubSummary.findMany({
      where: { importBatchId: batchId },
      orderBy: { id: "asc" },
    }),
  ]);
  if (!batch) notFound();

  const clubs = getConfirmClubs(summaries);
  const destination = getConfirmPageRedirect(batch, clubs.length);
  if (destination) redirect(destination);

  const state = getConfirmPageState(batch);
  const session = batch.demoSession;
  const finalized = state.stage !== "ready";

  // Once finalized, the customer shown is the one actually saved on the session.
  const customer = getStagedCustomerSummary({
    ...batch,
    customerResolution: finalized && session ? "existing" : batch.customerResolution,
    selectedGolfClient: finalized && session ? session.client : batch.selectedGolfClient,
  });

  // Read-only lookup; never creates anything. Failures just hide the details.
  const opportunityId =
    batch.opportunityResolution === "existing"
      ? batch.selectedGhlOpportunityId
      : (session?.ghlOpportunityId ?? null);
  const opportunity = opportunityId
    ? await getOpportunityById(opportunityId)
    : null;
  const opportunityMeta = opportunity
    ? formatOpportunityMeta({
        status: opportunity.status ?? null,
        createdAt: normalizeOpportunityCreatedAt(opportunity.createdAt),
      })
    : null;

  // The saved rep always wins; otherwise show the staff member who will finalize.
  let salesRep = session?.salesRep ?? null;
  if (!session) {
    const token = (await cookies()).get(STAFF_SESSION_COOKIE)?.value;
    const verified = token ? verifyStaffSessionToken(token) : null;
    if (verified?.valid) {
      const staffUser = await db.staffUser.findUnique({
        where: { id: verified.payload.staffUserId },
        select: { name: true },
      });
      salesRep = staffUser?.name ?? null;
    }
  }

  const fittingDate = formatFittingDate(
    batch.trackmanSessionDate ?? session?.demoDate ?? null,
  );

  return (
    <div>
      <StagedFittingHeader
        title="Confirm Fitting"
        description="Review the details below before finalizing this fitting."
        customer={customer}
      />

      <div className="w-full max-w-3xl space-y-4">
        <section aria-labelledby="confirm-opportunity">
          <h2 id="confirm-opportunity" className={sectionHeading}>
            Opportunity
          </h2>
          <div className="mt-2 rounded-lg border border-border bg-card px-4 py-2.5">
            {opportunityId ? (
              <>
                <p className="text-sm font-semibold text-foreground font-body">
                  {opportunity?.name || "Existing opportunity"}
                </p>
                <p className="mt-0.5 text-xs capitalize text-muted-foreground font-body">
                  {opportunityMeta ?? "Details unavailable"}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-foreground font-body">
                  New Opportunity
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground font-body">
                  {finalized
                    ? "A new Golf Demo opportunity will be created when the CRM sync completes."
                    : "A new Golf Demo opportunity will be created when this fitting is finalized."}
                </p>
              </>
            )}
          </div>
        </section>

        <section aria-labelledby="confirm-fitting">
          <h2 id="confirm-fitting" className={sectionHeading}>
            Fitting
          </h2>
          <dl className="mt-2 grid grid-cols-3 gap-3 rounded-lg border border-border bg-card px-4 py-2.5">
            <div>
              <dt className="text-xs text-muted-foreground font-body">
                Session date
              </dt>
              <dd className="text-sm font-semibold text-foreground font-body">
                {fittingDate ?? "—"}
              </dd>
            </div>
            {salesRep && (
              <div>
                <dt className="text-xs text-muted-foreground font-body">
                  Sales rep
                </dt>
                <dd className="text-sm font-semibold text-foreground font-body">
                  {salesRep}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-muted-foreground font-body">Clubs</dt>
              <dd className="text-sm font-semibold text-foreground font-body">
                {clubs.length}
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="confirm-clubs">
          <h2 id="confirm-clubs" className={sectionHeading}>
            Clubs included
          </h2>
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-card">
            {clubs.map((club) => (
              <li
                key={club.id}
                className="flex items-start justify-between gap-3 px-4 py-1.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground font-body">
                    {club.name}
                  </p>
                  {club.tags.length > 0 && (
                    <p className="text-xs text-muted-foreground font-body">
                      {club.tags.join(", ")}
                    </p>
                  )}
                  {club.comparedWith && (
                    <p className="text-xs text-muted-foreground font-body">
                      Compared with {club.comparedWith}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground font-body">
                  {club.shotCount} {club.shotCount === 1 ? "shot" : "shots"}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <ConfirmActions
          batchId={batch.id}
          initialStage={state.stage}
          syncAttempted={state.syncAttempted}
          initialError={state.error}
        />
      </div>
    </div>
  );
}
