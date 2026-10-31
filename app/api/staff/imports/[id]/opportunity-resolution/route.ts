import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import {
  listOpenOpportunitiesForContact,
  validateOpportunitySelection,
} from "@/lib/ghl/opportunities";
import { hasPersistedCustomerResolution } from "@/lib/imports/customer-workflow-routing";
import {
  hasGhlContactId,
  isOpportunityResolutionMutable,
  parseOpportunityResolution,
} from "@/lib/imports/opportunity-resolution";
import type { CustomerResolutionState } from "@/lib/imports/customer-resolution";
import { normalizeOpportunityCreatedAt } from "@/lib/imports/opportunity-page";

const BATCH_FIELDS = {
  id: true,
  parserMode: true,
  demoSessionId: true,
  customerResolution: true,
  selectedGolfClientId: true,
  proposedFirstName: true,
  proposedLastName: true,
  proposedEmail: true,
  proposedPhone: true,
  opportunityResolution: true,
  selectedGhlOpportunityId: true,
  selectedGolfClient: {
    select: { ghlContactId: true },
  },
} as const;

type OpportunityBatch = Prisma.ImportBatchGetPayload<{
  select: typeof BATCH_FIELDS;
}>;

function customerState(
  batch: NonNullable<OpportunityBatch>,
): CustomerResolutionState {
  return {
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
}

function opportunityState(batch: NonNullable<OpportunityBatch>) {
  return {
    opportunityResolution:
      batch.opportunityResolution === "existing" ||
      batch.opportunityResolution === "new"
        ? batch.opportunityResolution
        : null,
    selectedGhlOpportunityId: batch.selectedGhlOpportunityId,
  };
}

async function loadBatch(batchId: number) {
  return db.importBatch.findUnique({
    where: { id: batchId },
    select: BATCH_FIELDS,
  });
}

function parseBatchId(id: string): number | null {
  if (!/^[1-9]\d*$/.test(id)) return null;
  const batchId = Number(id);
  return Number.isSafeInteger(batchId) ? batchId : null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!getStaffSessionFromRequest(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await params;
  const batchId = parseBatchId(id);
  if (batchId === null) {
    return NextResponse.json({ error: "Invalid batch ID." }, { status: 400 });
  }

  const batch = await loadBatch(batchId);
  if (!batch) {
    return NextResponse.json({ error: "Import batch not found." }, { status: 404 });
  }

  const state = opportunityState(batch);
  const contactId =
    batch.customerResolution === "existing"
      ? batch.selectedGolfClient?.ghlContactId
      : null;
  const canSelectExisting =
    batch.parserMode === "trackman-result" &&
    batch.demoSessionId === null &&
    hasPersistedCustomerResolution(customerState(batch)) &&
    hasGhlContactId(contactId);

  let opportunities: Awaited<
    ReturnType<typeof listOpenOpportunitiesForContact>
  > = [];
  if (canSelectExisting) {
    try {
      opportunities = await listOpenOpportunitiesForContact(contactId);
    } catch (error) {
      console.error(
        "[GET /api/staff/imports/[id]/opportunity-resolution] GHL lookup failed:",
        error,
      );
      return NextResponse.json(
        { error: "Could not load opportunities from GHL. Please try again." },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({
    state,
    canModify: isOpportunityResolutionMutable({
      ...customerState(batch),
      parserMode: batch.parserMode,
      demoSessionId: batch.demoSessionId,
    }),
    canSelectExisting,
    opportunities: opportunities.map((opportunity) => ({
      id: opportunity.id,
      name: opportunity.name,
      pipelineStageId: opportunity.pipelineStageId,
      status: opportunity.status,
      createdAt: normalizeOpportunityCreatedAt(opportunity.createdAt),
    })),
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!getStaffSessionFromRequest(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await params;
  const batchId = parseBatchId(id);
  if (batchId === null) {
    return NextResponse.json({ error: "Invalid batch ID." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = parseOpportunityResolution(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const batch = await loadBatch(batchId);
  if (!batch) {
    return NextResponse.json({ error: "Import batch not found." }, { status: 404 });
  }

  if (
    !isOpportunityResolutionMutable({
      ...customerState(batch),
      parserMode: batch.parserMode,
      demoSessionId: batch.demoSessionId,
    })
  ) {
    return NextResponse.json(
      {
        error:
          "Opportunity resolution can only be changed for an unlinked TrackMan import with a resolved customer.",
      },
      { status: 409 },
    );
  }

  if (parsed.state.opportunityResolution === "existing") {
    const contactId =
      batch.customerResolution === "existing"
        ? batch.selectedGolfClient?.ghlContactId
        : null;
    if (!hasGhlContactId(contactId)) {
      return NextResponse.json(
        {
          error:
            "Existing opportunities are unavailable because this customer has no GHL contact.",
        },
        { status: 409 },
      );
    }

    try {
      const validation = await validateOpportunitySelection(
        parsed.state.selectedGhlOpportunityId!,
        contactId,
      );
      if (!validation.valid) {
        return NextResponse.json(
          {
            error:
              validation.reason === "not_found"
                ? "The selected GHL opportunity was not found."
                : "The selected opportunity is not an open opportunity for this customer in the Swing Locker pipeline.",
          },
          { status: 400 },
        );
      }
    } catch (error) {
      console.error(
        "[PUT /api/staff/imports/[id]/opportunity-resolution] GHL validation failed:",
        error,
      );
      return NextResponse.json(
        {
          error:
            "Could not validate the selected opportunity with GHL. Please try again.",
        },
        { status: 502 },
      );
    }
  }

  const update = await db.importBatch.updateMany({
    where: {
      id: batchId,
      parserMode: "trackman-result",
      demoSessionId: null,
      customerResolution: batch.customerResolution,
      selectedGolfClientId: batch.selectedGolfClientId,
      proposedFirstName: batch.proposedFirstName,
      proposedLastName: batch.proposedLastName,
      proposedEmail: batch.proposedEmail,
      proposedPhone: batch.proposedPhone,
      opportunityResolution: batch.opportunityResolution,
      selectedGhlOpportunityId: batch.selectedGhlOpportunityId,
    },
    data: parsed.state,
  });
  if (update.count === 0) {
    return NextResponse.json(
      { error: "Opportunity resolution changed concurrently. Reload and retry." },
      { status: 409 },
    );
  }

  return NextResponse.json({ success: true, state: parsed.state });
}
