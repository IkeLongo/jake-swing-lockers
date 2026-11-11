import { randomUUID } from "crypto";
import { Prisma } from "@/app/generated/prisma/client";
import { associateApprovedContactInTransaction } from "@/lib/ghl/customerContactCreationCoordinator";
import { enqueueCustomerSync } from "@/lib/ghl/customerSyncOutbox";
import type {
  ImportClubSummary,
  PrismaClient,
} from "@/app/generated/prisma/client";
import { validateOpportunitySelection } from "@/lib/ghl/opportunities";
import { createPrismaFinalizeStore } from "./finalizationStore";
import { loadClientsForDuplicateCheck } from "./new-customer-review-store";
import { GhlContactAssociationConflictError } from "./staged-finalization";
import type {
  StagedFinalizeBatch,
  StagedFinalizeDeps,
  StagedFinalizeTx,
} from "./staged-finalization";

const BATCH_SELECT = {
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
  newCustomerConfirmationSignature: true,
  ghlContactDecision: true,
  approvedGhlContactId: true,
  ghlContactApprovalSignature: true,
  ghlContactApprovedAt: true,
  ghlContactApprovedByStaffUserId: true,
  ghlContactReviewSnapshot: true,
  opportunityResolution: true,
  selectedGhlOpportunityId: true,
  proposedOpportunityName: true,
  fittingDateOverride: true,
  trackmanSessionDate: true,
  selectedGolfClient: {
    select: {
      id: true,
      ghlContactId: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
    },
  },
  demoSession: {
    select: { id: true, status: true, clientId: true, ghlOpportunityId: true },
  },
} as const;

type Reader = Pick<
  Prisma.TransactionClient,
  "importBatch" | "importClubSummary"
>;

function loadBatch(
  client: Reader,
  batchId: number,
): Promise<StagedFinalizeBatch | null> {
  return client.importBatch.findUnique({
    where: { id: batchId },
    select: BATCH_SELECT,
  });
}

function loadSummaries(client: Reader, batchId: number) {
  return client.importClubSummary.findMany({
    where: { importBatchId: batchId },
    orderBy: { id: "asc" },
  });
}

function createTx(
  tx: Prisma.TransactionClient,
): StagedFinalizeTx<ImportClubSummary> {
  return {
    async lockBatch(batchId) {
      await tx.$queryRaw`SELECT id FROM ImportBatch WHERE id = ${batchId} FOR UPDATE`;
    },
    async lockNewCustomerCreation() {
      await tx.$queryRaw`SELECT id FROM StagedCustomerCreationMutex WHERE id = 1 FOR UPDATE`;
    },
    loadBatch: (batchId) => loadBatch(tx, batchId),
    loadSummaries: (batchId) => loadSummaries(tx, batchId),
    listClientsForDuplicateCheck: () => loadClientsForDuplicateCheck(tx),
    async createClient(data) {
      const customer = await tx.golfClient.create({
        data,
        select: { id: true },
      });
      await enqueueCustomerSync(tx, {
        golfClientId: customer.id,
        reason: "created",
      });
      return customer;
    },
    async associateClientWithGhlContact(clientId, ghlContactId) {
      const result = await associateApprovedContactInTransaction(
        tx,
        clientId,
        ghlContactId,
      );
      if (result.status !== "linked" && result.status !== "already_linked") {
        throw new GhlContactAssociationConflictError();
      }
    },
    createFinalizedSession: (data) =>
      tx.demoSession.create({
        data: {
          clientId: data.clientId,
          lockerToken: randomUUID(),
          demoDate: data.demoDate,
          salesRep: data.salesRep,
          ghlOpportunityId: data.ghlOpportunityId,
          status: "finalized",
          needsRefinalization: false,
          journeyStage: "demo_completed",
        },
        select: { id: true },
      }),
    async markBatchFinalized(batchId, demoSessionId) {
      await tx.importBatch.update({
        where: { id: batchId },
        data: { demoSessionId, status: "finalized" },
      });
    },
    clubStore: createPrismaFinalizeStore(tx),
  };
}

export function createPrismaStagedFinalizeDeps(
  db: PrismaClient,
): StagedFinalizeDeps<ImportClubSummary> {
  return {
    loadBatch: (batchId) => loadBatch(db, batchId),
    loadSummaries: (batchId) => loadSummaries(db, batchId),
    validateOpportunity: validateOpportunitySelection,
    transaction: (fn) =>
      db.$transaction((tx) => fn(createTx(tx)), {
        maxWait: 10_000,
        timeout: 30_000,
      }),
    now: () => new Date(),
  };
}
