import type { PrismaClient } from "@/app/generated/prisma/client";
import { updateContactCustomFields } from "./contacts";
import { resolveStagedContact } from "./resolveStagedContact";
import { stagedContactApi } from "./stagedContactApi";
import { encodeSyncError } from "./syncErrorMarker";
import { addTagsToContact } from "./tags";
import {
  createGolfDemoOpportunity,
  validateOpportunitySelection,
} from "./opportunities";
import type { StagedSyncDeps } from "./syncStagedFitting";

export function createPrismaStagedSyncDeps(db: PrismaClient): StagedSyncDeps {
  return {
    loadBatch: (batchId) =>
      db.importBatch.findUnique({
        where: { id: batchId },
        select: {
          id: true,
          parserMode: true,
          status: true,
          opportunityResolution: true,
          selectedGhlOpportunityId: true,
          demoSession: {
            select: {
              id: true,
              status: true,
              lockerToken: true,
              demoDate: true,
              salesRep: true,
              currentClub: true,
              ghlOpportunityId: true,
              ghlSyncStatus: true,
              ghlLockerReadyTagAddedAt: true,
              clubTests: {
                select: {
                  clubRole: true,
                  clubType: true,
                  brand: true,
                  model: true,
                  isRecommended: true,
                  estimatedPrice: true,
                },
                orderBy: [{ pairIndex: "asc" }, { clubRole: "asc" }],
              },
              client: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                  phone: true,
                  ghlContactId: true,
                },
              },
            },
          },
        },
      }),

    resolveContact: async (input, savedGhlContactId) =>
      resolveStagedContact(stagedContactApi, input, savedGhlContactId),

    async saveContactId(clientId, ghlContactId) {
      await db.golfClient.update({
        where: { id: clientId },
        data: {
          ghlContactId,
          ghlLastSyncedAt: new Date(),
          ghlSyncStatus: "contact_resolved",
          ghlSyncError: null,
        },
      });
    },

    validateOpportunity: validateOpportunitySelection,
    createOpportunity: createGolfDemoOpportunity,

    // Short row lock on this session only; released as soon as the ID is saved.
    ensureOpportunityId(sessionId, create) {
      return db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM DemoSession WHERE id = ${sessionId} FOR UPDATE`;
          const row = await tx.demoSession.findUniqueOrThrow({
            where: { id: sessionId },
            select: { ghlOpportunityId: true },
          });
          if (row.ghlOpportunityId) return row.ghlOpportunityId;

          const created = await create();
          await tx.demoSession.update({
            where: { id: sessionId },
            data: { ghlOpportunityId: created },
          });
          return created;
        },
        { maxWait: 10_000, timeout: 30_000 },
      );
    },

    updateContactCustomFields,
    addTags: addTagsToContact,

    async markTagsAdded(sessionId, lockerUrl) {
      await db.demoSession.update({
        where: { id: sessionId },
        data: { lockerUrl, ghlLockerReadyTagAddedAt: new Date() },
      });
    },

    async markSynced({ sessionId, clientId, ghlContactId, ghlOpportunityId, lockerUrl }) {
      const now = new Date();
      await db.demoSession.update({
        where: { id: sessionId },
        data: {
          lockerUrl,
          ghlLastSyncedAt: now,
          ghlSyncStatus: "synced",
          ghlSyncError: null,
        },
      });
      await db.golfClient.update({
        where: { id: clientId },
        data: { ghlSyncStatus: "synced", ghlLastSyncedAt: now, ghlSyncError: null },
      });
      await db.ghlSyncEvent.create({
        data: {
          demoSessionId: sessionId,
          ghlContactId,
          eventType: "demo_sync",
          status: "success",
          message: `Synced staged demo session ${sessionId} to GHL. Opportunity: ${ghlOpportunityId}`,
        },
      });
    },

    async markFailed({ sessionId, clientId, ghlContactId, message, retryable }) {
      const now = new Date();
      await db.demoSession.update({
        where: { id: sessionId },
        data: {
          ghlLastSyncedAt: now,
          ghlSyncStatus: "failed",
          ghlSyncError: encodeSyncError(message, retryable),
        },
      });
      await db.golfClient.update({
        where: { id: clientId },
        data: { ghlLastSyncedAt: now, ghlSyncStatus: "failed", ghlSyncError: message },
      });
      await db.ghlSyncEvent.create({
        data: {
          demoSessionId: sessionId,
          ghlContactId: ghlContactId ?? undefined,
          eventType: "demo_sync",
          status: "error",
          message,
        },
      });
    },

    now: () => new Date(),
    appBaseUrl: () =>
      process.env.APP_BASE_URL ?? "https://jlgolfsales.rivercitycreatives.com",
  };
}
