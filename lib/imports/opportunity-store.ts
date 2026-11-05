import type { PrismaClient } from "@/app/generated/prisma/client";
import {
  listOpenOpportunitiesForContact,
  validateOpportunitySelection,
} from "@/lib/ghl/opportunities";
import { GHL_APPROVAL_BATCH_SELECT } from "./ghl-approval-gate";
import type { OpportunitySelectionDeps } from "./opportunity-selection";

export function createPrismaOpportunityDeps(
  db: PrismaClient,
): OpportunitySelectionDeps {
  return {
    async loadBatch(batchId) {
      const row = await db.importBatch.findUnique({
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
          trackmanSessionDate: true,
          ...GHL_APPROVAL_BATCH_SELECT,
          selectedGolfClient: {
            select: { firstName: true, lastName: true, email: true, phone: true },
          },
        },
      });
      if (!row) return null;
      const { selectedGolfClient, ...batch } = row;
      return {
        ...batch,
        client: batch.customerResolution === "existing" ? selectedGolfClient : null,
      };
    },

    listOpen: (contactId) => listOpenOpportunitiesForContact(contactId),

    validate: async (opportunityId, contactId) => {
      const result = await validateOpportunitySelection(opportunityId, contactId);
      return result.valid
        ? { valid: true }
        : { valid: false, reason: result.reason };
    },

    async commit(expected, state) {
      const result = await db.importBatch.updateMany({
        where: {
          id: expected.id,
          parserMode: "trackman-result",
          demoSessionId: null,
          customerResolution: expected.customerResolution,
          selectedGolfClientId: expected.selectedGolfClientId,
          proposedFirstName: expected.proposedFirstName,
          proposedLastName: expected.proposedLastName,
          proposedEmail: expected.proposedEmail,
          proposedPhone: expected.proposedPhone,
          opportunityResolution: expected.opportunityResolution,
          selectedGhlOpportunityId: expected.selectedGhlOpportunityId,
          proposedOpportunityName: expected.proposedOpportunityName,
          fittingDateOverride: expected.fittingDateOverride,
          trackmanSessionDate: expected.trackmanSessionDate,
          ghlContactDecision: expected.ghlContactDecision,
          approvedGhlContactId: expected.approvedGhlContactId,
          ghlContactApprovalSignature: expected.ghlContactApprovalSignature,
          ...(expected.client
            ? { selectedGolfClient: { is: { ...expected.client } } }
            : {}),
        },
        data: state,
      });
      return result.count === 1;
    },
  };
}
