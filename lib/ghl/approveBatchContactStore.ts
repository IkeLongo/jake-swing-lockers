import { Prisma, type PrismaClient } from "@/app/generated/prisma/client";
import { createPrismaDiscoveryDeps } from "./discoverBatchContactStore";
import type { ApprovalDeps } from "./approveBatchContact";

/** Resets the GHL contact decision. Spread into any write that changes customer identity. */
export const CLEARED_GHL_APPROVAL_DATA = {
  ghlContactDecision: null,
  approvedGhlContactId: null,
  ghlContactApprovalSignature: null,
  ghlContactApprovedAt: null,
  ghlContactApprovedByStaffUserId: null,
  ghlContactReviewSnapshot: Prisma.DbNull,
} as const;

export function createPrismaApprovalDeps(db: PrismaClient): ApprovalDeps {
  return {
    ...createPrismaDiscoveryDeps(db),

    loadApprovalBatch: (batchId) =>
      db.importBatch.findUnique({
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
          newCustomerConfirmationSignature: true,
          ghlContactDecision: true,
          approvedGhlContactId: true,
          ghlContactApprovalSignature: true,
          ghlContactApprovedAt: true,
          ghlContactApprovedByStaffUserId: true,
          ghlContactReviewSnapshot: true,
        },
      }),

    // A single updateMany is one atomic statement: the decision and the
    // downstream opportunity reset land together or not at all.
    async commitApproval(expected, clientGuard, write) {
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
          newCustomerConfirmationSignature: expected.newCustomerConfirmationSignature,
          ghlContactDecision: expected.ghlContactDecision,
          approvedGhlContactId: expected.approvedGhlContactId,
          ghlContactApprovalSignature: expected.ghlContactApprovalSignature,
          ...(clientGuard ? { selectedGolfClient: { is: { ...clientGuard } } } : {}),
        },
        data: {
          ghlContactDecision: write.decision,
          approvedGhlContactId: write.approvedContactId,
          ghlContactApprovalSignature: write.signature,
          ghlContactApprovedAt: write.approvedAt,
          ghlContactApprovedByStaffUserId: write.approvedByStaffUserId,
          ghlContactReviewSnapshot: write.snapshot
            ? (write.snapshot as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
          ...(write.clearOpportunity
            ? { opportunityResolution: null, selectedGhlOpportunityId: null }
            : {}),
        },
      });
      return result.count === 1;
    },

    now: () => new Date(),
  };
}
