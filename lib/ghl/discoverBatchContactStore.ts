import type { Prisma } from "@/app/generated/prisma/client";
import { loadClientsForDuplicateCheck } from "@/lib/imports/new-customer-review-store";
import type { BatchDiscoveryDeps } from "./discoverBatchContact";
import { stagedContactApi } from "./stagedContactApi";

type Reader = Pick<Prisma.TransactionClient, "importBatch" | "golfClient">;

// Read-only: only findUnique/findMany are used, and discovery only calls the
// GET lookups on the GHL api.
export function createPrismaDiscoveryDeps(db: Reader): BatchDiscoveryDeps {
  return {
    api: stagedContactApi,
    loadBatch: (batchId) =>
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
          newCustomerConfirmationSignature: true,
        },
      }),
    loadClient: (clientId) =>
      db.golfClient.findUnique({
        where: { id: clientId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          ghlContactId: true,
        },
      }),
    loadDuplicateClients: () => loadClientsForDuplicateCheck(db),
    findLinkedClients: (contactIds) =>
      db.golfClient.findMany({
        where: { ghlContactId: { in: contactIds } },
        select: { id: true, firstName: true, lastName: true, ghlContactId: true },
      }),
  };
}
