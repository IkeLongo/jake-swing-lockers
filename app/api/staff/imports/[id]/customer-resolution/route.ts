import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import {
  hasSameCustomerIdentity,
  parseCustomerResolution,
  parseNewCustomerConfirmation,
} from "@/lib/imports/customer-resolution";
import { getOpportunityStateAfterCustomerChange } from "@/lib/imports/opportunity-resolution";
import {
  buildNewCustomerReview,
  decideNewCustomerSave,
} from "@/lib/imports/new-customer-review-server";
import { loadClientsForDuplicateCheck } from "@/lib/imports/new-customer-review-store";
import { shouldClearGhlApprovalOnCustomerChange } from "@/lib/imports/ghl-contact-approval";
import { CLEARED_GHL_APPROVAL_DATA } from "@/lib/ghl/approveBatchContactStore";

const CLEARED_CONFIRMATION = {
  newCustomerConfirmationSignature: null,
  newCustomerConfirmedAt: null,
  newCustomerConfirmedByStaffUserId: null,
  newCustomerReviewedCandidates: Prisma.DbNull,
};

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = getStaffSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) {
    return NextResponse.json({ error: "Invalid batch ID." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = parseCustomerResolution(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const confirmation = parseNewCustomerConfirmation(body);
  if (!confirmation.success) {
    return NextResponse.json({ error: confirmation.error }, { status: 400 });
  }

  const batchId = Number(id);
  if (!Number.isSafeInteger(batchId)) {
    return NextResponse.json({ error: "Invalid batch ID." }, { status: 400 });
  }

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
      opportunityResolution: true,
      selectedGhlOpportunityId: true,
      proposedOpportunityName: true,
      fittingDateOverride: true,
      newCustomerConfirmationSignature: true,
      ghlContactDecision: true,
      approvedGhlContactId: true,
      ghlContactApprovalSignature: true,
    },
  });
  if (!batch) {
    return NextResponse.json({ error: "Import batch not found." }, { status: 404 });
  }
  if (batch.parserMode !== "trackman-result" || batch.demoSessionId !== null) {
    return NextResponse.json(
      { error: "Customer resolution can only be staged for unlinked TrackMan imports." },
      { status: 409 },
    );
  }

  if (parsed.state.selectedGolfClientId !== null) {
    const selectedClient = await db.golfClient.findUnique({
      where: { id: parsed.state.selectedGolfClientId },
      select: { id: true },
    });
    if (!selectedClient) {
      return NextResponse.json({ error: "GolfClient not found." }, { status: 404 });
    }
  }

  const currentCustomer = {
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
  } as const;

  // Duplicate candidates are always recomputed here; the client only supplies
  // the signature of the candidate set it reviewed.
  const duplicateClients =
    parsed.state.customerResolution === "new"
      ? await loadClientsForDuplicateCheck(db)
      : [];
  let confirmationData: Record<string, unknown> = CLEARED_CONFIRMATION;
  if (parsed.state.customerResolution === "new") {
    const decision = decideNewCustomerSave({
      clients: duplicateClients,
      proposed: {
        email: parsed.state.proposedEmail,
        phone: parsed.state.proposedPhone,
      },
      identityUnchanged: hasSameCustomerIdentity(currentCustomer, parsed.state),
      storedSignature: batch.newCustomerConfirmationSignature,
      submittedSignature: confirmation.submittedSignature,
    });
    if (decision.outcome !== "save") {
      return NextResponse.json(
        {
          error:
            decision.outcome === "review_changed"
              ? "Matching customers changed since you reviewed them. Review the matches again."
              : "An existing customer matches this email or phone number. Review the matches before saving.",
          code:
            decision.outcome === "review_changed"
              ? "review_changed"
              : "duplicate_review_required",
          review: decision.review,
        },
        { status: 409 },
      );
    }
    if (decision.confirmation.action === "keep") {
      confirmationData = {};
    } else if (decision.confirmation.action === "set") {
      confirmationData = {
        newCustomerConfirmationSignature: decision.confirmation.signature,
        newCustomerConfirmedAt: new Date(),
        newCustomerConfirmedByStaffUserId: session.staffUserId,
        newCustomerReviewedCandidates: decision.confirmation.snapshot,
      };
    }
  }

  const opportunityState = getOpportunityStateAfterCustomerChange(
    currentCustomer,
    parsed.state,
    {
      opportunityResolution:
        batch.opportunityResolution === "existing" ||
        batch.opportunityResolution === "new"
          ? batch.opportunityResolution
          : null,
      selectedGhlOpportunityId: batch.selectedGhlOpportunityId,
      proposedOpportunityName: batch.proposedOpportunityName,
      fittingDateOverride: batch.fittingDateOverride,
    },
  );

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
      proposedOpportunityName: batch.proposedOpportunityName,
      fittingDateOverride: batch.fittingDateOverride,
      newCustomerConfirmationSignature: batch.newCustomerConfirmationSignature,
      ghlContactDecision: batch.ghlContactDecision,
      approvedGhlContactId: batch.approvedGhlContactId,
      ghlContactApprovalSignature: batch.ghlContactApprovalSignature,
    },
    data: {
      ...parsed.state,
      ...opportunityState,
      ...confirmationData,
      // Same atomic write as the identity change, so a stale GHL approval can
      // never outlive the customer it was reviewed for.
      ...(shouldClearGhlApprovalOnCustomerChange(currentCustomer, parsed.state)
        ? CLEARED_GHL_APPROVAL_DATA
        : {}),
    },
  });
  if (update.count === 0) {
    return NextResponse.json(
      { error: "Customer resolution is unavailable for this import." },
      { status: 409 },
    );
  }

  const persisted = await db.importBatch.findUnique({
    where: { id: batchId },
    select: {
      customerResolution: true,
      selectedGolfClientId: true,
      proposedFirstName: true,
      proposedLastName: true,
      proposedEmail: true,
      proposedPhone: true,
      newCustomerConfirmationSignature: true,
    },
  });
  if (!persisted) {
    return NextResponse.json({ error: "Import batch not found." }, { status: 404 });
  }

  const { newCustomerConfirmationSignature, ...state } = persisted;
  const review =
    state.customerResolution === "new"
      ? buildNewCustomerReview(
          duplicateClients,
          { email: state.proposedEmail, phone: state.proposedPhone },
          newCustomerConfirmationSignature,
        )
      : null;

  return NextResponse.json({ success: true, state, review });
}
