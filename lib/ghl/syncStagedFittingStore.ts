import { Prisma, type PrismaClient } from "@/app/generated/prisma/client";
import { GhlApiError, GhlDuplicateContactError } from "./client";
import { updateContactCustomFields } from "./contacts";
import {
  ContactNeedsReviewError,
  findStagedContactMatch,
  usableEmail,
  usablePhone,
} from "./resolveStagedContact";
import { stagedContactApi } from "./stagedContactApi";
import { encodeSyncError } from "./syncErrorMarker";
import { addTagsToContact } from "./tags";
import {
  createGolfDemoOpportunity,
  validateOpportunitySelection,
} from "./opportunities";
import {
  CreationNeedsReconciliationError,
  type StagedSyncDeps,
  type StagedSyncState,
} from "./syncStagedFitting";

type SyncStoreDb = Pick<
  Prisma.TransactionClient,
  "$queryRaw" | "demoSession" | "golfClient" | "ghlSyncEvent"
>;

interface CustomerContactCreationState {
  version: 1;
  status: "creating";
  sessionId: number;
  batchId: number;
  attemptedAt: string;
}

const RECONCILIATION_REQUIRED =
  "A GHL creation request may have succeeded, but its ID was not safely persisted. Do not retry automatically; reconcile this attempt in GHL first.";

function readSyncState(value: unknown): StagedSyncState {
  if (value === null || value === undefined) return { version: 1 };
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new CreationNeedsReconciliationError(RECONCILIATION_REQUIRED);
  }
  const state = value as Record<string, unknown>;
  const contact = state.contact;
  const opportunity = state.opportunity;
  const contactState =
    typeof contact === "object" && contact !== null && !Array.isArray(contact)
      ? contact as Record<string, unknown>
      : null;
  const validContact =
    contact === undefined ||
    (contactState !== null &&
      Number.isSafeInteger(contactState.batchId) &&
      Number.isSafeInteger(contactState.clientId) &&
      ((contactState.status === "creating" &&
        typeof contactState.attemptedAt === "string") ||
        (contactState.status === "resolved" &&
          typeof contactState.contactId === "string" &&
          contactState.contactId.length > 0)));
  const validOpportunity =
    opportunity === undefined ||
    (typeof opportunity === "object" &&
      opportunity !== null &&
      !Array.isArray(opportunity) &&
      (opportunity as Record<string, unknown>).status === "creating" &&
      Number.isSafeInteger((opportunity as Record<string, unknown>).batchId) &&
      typeof (opportunity as Record<string, unknown>).contactId === "string" &&
      typeof (opportunity as Record<string, unknown>).attemptedAt === "string");
  if (state.version !== 1 || !validContact || !validOpportunity) {
    throw new CreationNeedsReconciliationError(RECONCILIATION_REQUIRED);
  }
  return value as StagedSyncState;
}

function stateValue(state: StagedSyncState): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return Object.keys(state).length === 1
    ? Prisma.DbNull
    : JSON.parse(JSON.stringify(state)) as Prisma.InputJsonValue;
}

function readCustomerContactCreationState(
  value: unknown,
): CustomerContactCreationState | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new CreationNeedsReconciliationError(RECONCILIATION_REQUIRED);
  }
  const state = value as Record<string, unknown>;
  if (
    state.version !== 1 ||
    state.status !== "creating" ||
    typeof state.sessionId !== "number" ||
    !Number.isSafeInteger(state.sessionId) ||
    typeof state.batchId !== "number" ||
    !Number.isSafeInteger(state.batchId) ||
    typeof state.attemptedAt !== "string"
  ) {
    throw new CreationNeedsReconciliationError(RECONCILIATION_REQUIRED);
  }
  return {
    version: 1,
    status: "creating",
    sessionId: state.sessionId,
    batchId: state.batchId,
    attemptedAt: state.attemptedAt,
  };
}

function customerContactCreationStateValue(
  state: CustomerContactCreationState,
): Prisma.InputJsonValue {
  return {
    version: state.version,
    status: state.status,
    sessionId: state.sessionId,
    batchId: state.batchId,
    attemptedAt: state.attemptedAt,
  };
}

function withoutContact(state: StagedSyncState): StagedSyncState {
  return {
    version: state.version,
    ...(state.opportunity ? { opportunity: state.opportunity } : {}),
  };
}

function withoutOpportunity(state: StagedSyncState): StagedSyncState {
  return {
    version: state.version,
    ...(state.contact ? { contact: state.contact } : {}),
  };
}

function isDefinitiveRejection(error: unknown): boolean {
  return (
    error instanceof GhlApiError &&
    [400, 401, 403, 404, 422, 429].includes(error.status)
  );
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function assertContactAvailableToClient(
  db: SyncStoreDb,
  clientId: number,
  ghlContactId: string,
): Promise<void> {
  const owner = await db.golfClient.findUnique({
    where: { ghlContactId },
    select: { id: true },
  });
  if (owner && owner.id !== clientId) {
    throw new ContactNeedsReviewError(
      "identity_conflict",
      "The approved GHL contact is already linked to a different local customer.",
    );
  }
}

async function persistClientContact(
  db: SyncStoreDb,
  clientId: number,
  ghlContactId: string,
  clearCreationAttempt = false,
): Promise<void> {
  try {
    const updated = await db.golfClient.updateMany({
      where: {
        id: clientId,
        OR: [{ ghlContactId: null }, { ghlContactId }],
      },
      data: {
        ghlContactId,
        ...(clearCreationAttempt
          ? { ghlContactCreationState: Prisma.DbNull }
          : {}),
      },
    });
    if (updated.count !== 1) {
      throw new ContactNeedsReviewError(
        "identity_conflict",
        "The local customer is already linked to a different GHL contact.",
      );
    }
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ContactNeedsReviewError(
        "identity_conflict",
        "The approved GHL contact is already linked to a different local customer.",
      );
    }
    throw error;
  }
}

async function lockSession(
  db: SyncStoreDb,
  sessionId: number,
): Promise<void> {
  await db.$queryRaw`SELECT id FROM DemoSession WHERE id = ${sessionId} FOR UPDATE`;
}

async function lockCustomer(
  db: SyncStoreDb,
  clientId: number,
): Promise<void> {
  await db.$queryRaw`SELECT id FROM GolfClient WHERE id = ${clientId} FOR UPDATE`;
}

async function persistSessionState(
  db: SyncStoreDb,
  sessionId: number,
  state: StagedSyncState,
  updates: {
    ghlSyncStatus?: string | null;
    ghlSyncError?: string | null;
  } = {},
): Promise<void> {
  await db.demoSession.update({
    where: { id: sessionId },
    data: {
      ghlSyncState: stateValue(state),
      ...updates,
    },
  });
}

async function verifyApprovedContact(
  db: SyncStoreDb,
  ghlContactId: string,
  clientId: number,
): Promise<void> {
  const contact = await stagedContactApi.getContact(ghlContactId);
  if (!contact) {
    throw new ContactNeedsReviewError(
      "identity_conflict",
      "The approved GHL contact no longer exists. Review the customer decision before syncing.",
    );
  }
  if (contact.locationId !== stagedContactApi.locationId()) {
    throw new ContactNeedsReviewError(
      "wrong_location",
      "The approved GHL contact does not belong to the configured GHL location.",
    );
  }
  await assertContactAvailableToClient(db, clientId, ghlContactId);
}

export function createPrismaStagedSyncDeps(db: PrismaClient): StagedSyncDeps {
  const persistResolvedNewContact = async (
    sessionId: number,
    batchId: number,
    clientId: number,
    ghlContactId: string,
  ) => {
    await db.$transaction(async (tx) => {
      await lockCustomer(tx, clientId);
      await lockSession(tx, sessionId);
      const client = await tx.golfClient.findUniqueOrThrow({
        where: { id: clientId },
        select: { ghlContactId: true, ghlContactCreationState: true },
      });
      const customerAttempt = readCustomerContactCreationState(
        client.ghlContactCreationState,
      );
      if (
        !customerAttempt ||
        customerAttempt.sessionId !== sessionId ||
        customerAttempt.batchId !== batchId ||
        (client.ghlContactId !== null && client.ghlContactId !== ghlContactId)
      ) {
        throw new CreationNeedsReconciliationError(RECONCILIATION_REQUIRED);
      }
      const row = await tx.demoSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { ghlSyncState: true },
      });
      const state = readSyncState(row.ghlSyncState);
      if (
        state.contact &&
        (state.contact.batchId !== batchId ||
          state.contact.clientId !== clientId ||
          (state.contact.status === "resolved" &&
            state.contact.contactId !== ghlContactId))
      ) {
        throw new ContactNeedsReviewError(
          "identity_conflict",
          "The contact creation attempt no longer matches this customer.",
        );
      }
      await persistClientContact(tx, clientId, ghlContactId, true);
      const rest = withoutContact(state);
      await persistSessionState(
        tx,
        sessionId,
        {
          ...rest,
          contact: {
            status: "resolved",
            batchId,
            clientId,
            contactId: ghlContactId,
          },
        },
        { ghlSyncStatus: "contact_resolved", ghlSyncError: null },
      );
    }, { maxWait: 10_000, timeout: 30_000 });
  };

  const clearContactCreationAttempt = async (
    sessionId: number,
    batchId: number,
    clientId: number,
  ) => {
    await db.$transaction(async (tx) => {
      await lockCustomer(tx, clientId);
      await lockSession(tx, sessionId);
      const client = await tx.golfClient.findUniqueOrThrow({
        where: { id: clientId },
        select: { ghlContactCreationState: true },
      });
      const customerAttempt = readCustomerContactCreationState(
        client.ghlContactCreationState,
      );
      if (
        !customerAttempt ||
        customerAttempt.sessionId !== sessionId ||
        customerAttempt.batchId !== batchId
      ) {
        return;
      }
      const row = await tx.demoSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { ghlSyncState: true },
      });
      const state = readSyncState(row.ghlSyncState);
      if (
        state.contact?.status !== "creating" ||
        state.contact.batchId !== batchId ||
        state.contact.clientId !== clientId
      ) {
        return;
      }
      const rest = withoutContact(state);
      await tx.golfClient.update({
        where: { id: clientId },
        data: { ghlContactCreationState: Prisma.DbNull },
      });
      await persistSessionState(tx, sessionId, rest, {
        ghlSyncStatus: state.opportunity ? "failed" : null,
        ghlSyncError: state.opportunity
          ? encodeSyncError(RECONCILIATION_REQUIRED, false)
          : null,
      });
    }, { maxWait: 10_000, timeout: 30_000 });
  };

  const clearOpportunityCreationAttempt = async (sessionId: number) => {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM DemoSession WHERE id = ${sessionId} FOR UPDATE`;
      const row = await tx.demoSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { ghlSyncState: true, ghlSyncStatus: true },
      });
      const state = readSyncState(row.ghlSyncState);
      const rest = withoutOpportunity(state);
      await persistSessionState(tx, sessionId, rest, {
        ghlSyncStatus: state.contact?.status === "resolved" ? "contact_resolved" : null,
        ghlSyncError: null,
      });
    }, { maxWait: 10_000, timeout: 30_000 });
  };

  return {
    loadBatch: (batchId) =>
      db.importBatch.findUnique({
        where: { id: batchId },
        select: {
          id: true,
          parserMode: true,
          status: true,
          customerResolution: true,
          selectedGolfClientId: true,
          proposedFirstName: true,
          proposedLastName: true,
          proposedEmail: true,
          proposedPhone: true,
          ghlContactDecision: true,
          approvedGhlContactId: true,
          ghlContactApprovalSignature: true,
          ghlContactReviewSnapshot: true,
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
              ghlSyncState: true,
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

    verifyApprovedContact: (ghlContactId, clientId) =>
      verifyApprovedContact(db, ghlContactId, clientId),

    async resolveNewContact(input, { sessionId, batchId, clientId, savedGhlContactId }) {
      const [loadedSession, loadedClient] = await Promise.all([
        db.demoSession.findUniqueOrThrow({
          where: { id: sessionId },
          select: { ghlSyncState: true },
        }),
        db.golfClient.findUniqueOrThrow({
          where: { id: clientId },
          select: { ghlContactId: true, ghlContactCreationState: true },
        }),
      ]);
      const state = readSyncState(loadedSession.ghlSyncState);
      const contactState = state.contact;
      const customerAttempt = readCustomerContactCreationState(
        loadedClient.ghlContactCreationState,
      );
      const persistedContactId = loadedClient.ghlContactId;

      if (contactState?.status === "resolved") {
        if (
          contactState.batchId !== batchId ||
          contactState.clientId !== clientId ||
          !contactState.contactId ||
          persistedContactId !== contactState.contactId ||
          (savedGhlContactId !== null &&
            savedGhlContactId !== contactState.contactId) ||
          customerAttempt
        ) {
          throw new ContactNeedsReviewError(
            "identity_conflict",
            "The local customer contact link does not match the contact resolved for this fitting.",
          );
        }
        await verifyApprovedContact(db, contactState.contactId, clientId);
        return { id: contactState.contactId };
      }

      const matchingAttempt =
        customerAttempt?.sessionId === sessionId &&
        customerAttempt.batchId === batchId;
      if (customerAttempt && !matchingAttempt) {
        throw new CreationNeedsReconciliationError(RECONCILIATION_REQUIRED);
      }
      if (
        contactState?.status === "creating" &&
        (!matchingAttempt ||
          contactState.batchId !== batchId ||
          contactState.clientId !== clientId)
      ) {
        throw new CreationNeedsReconciliationError(RECONCILIATION_REQUIRED);
      }
      if (customerAttempt && contactState?.status !== "creating") {
        throw new CreationNeedsReconciliationError(RECONCILIATION_REQUIRED);
      }
      if (!customerAttempt && contactState?.status === "creating") {
        throw new CreationNeedsReconciliationError(RECONCILIATION_REQUIRED);
      }

      if (persistedContactId || savedGhlContactId) {
        throw new ContactNeedsReviewError(
          "identity_conflict",
          "This customer already has a saved GHL contact. Review the customer decision instead of creating or reusing another contact.",
        );
      }

      const recovering = Boolean(customerAttempt);
      const match = await findStagedContactMatch(stagedContactApi, input);
      if (match) {
        if (!recovering) {
          throw new ContactNeedsReviewError(
            "identity_conflict",
            "A matching GHL contact already exists. Review and approve it instead of creating a new contact.",
          );
        }
        await assertContactAvailableToClient(db, clientId, match.id);
        await persistResolvedNewContact(sessionId, batchId, clientId, match.id);
        return { id: match.id };
      }
      if (recovering) {
        throw new CreationNeedsReconciliationError(RECONCILIATION_REQUIRED);
      }

      const email = usableEmail(input.email);
      const phone = usablePhone(input.phone);
      if (!email && !phone) {
        throw new ContactNeedsReviewError(
          "missing_identifier",
          "This customer has no usable email or phone number to create a GHL contact.",
        );
      }

      const attemptedAt = new Date();
      const claimed = await db.$transaction(async (tx) => {
        await lockCustomer(tx, clientId);
        await lockSession(tx, sessionId);
        const client = await tx.golfClient.findUniqueOrThrow({
          where: { id: clientId },
          select: { ghlContactId: true, ghlContactCreationState: true },
        });
        const currentCustomerAttempt = readCustomerContactCreationState(
          client.ghlContactCreationState,
        );
        const sessionRow = await tx.demoSession.findUniqueOrThrow({
          where: { id: sessionId },
          select: { ghlSyncState: true },
        });
        const currentSessionState = readSyncState(sessionRow.ghlSyncState);
        if (
          client.ghlContactId ||
          currentCustomerAttempt ||
          currentSessionState.contact
        ) {
          return false;
        }
        const customerClaim: CustomerContactCreationState = {
          version: 1,
          status: "creating",
          sessionId,
          batchId,
          attemptedAt: attemptedAt.toISOString(),
        };
        const next: StagedSyncState = {
          ...currentSessionState,
          contact: {
            status: "creating",
            batchId,
            clientId,
            attemptedAt: attemptedAt.toISOString(),
          },
        };
        await tx.golfClient.update({
          where: { id: clientId },
          data: {
            ghlContactCreationState:
              customerContactCreationStateValue(customerClaim),
          },
        });
        await persistSessionState(tx, sessionId, next, {
          ghlSyncStatus: "failed",
          ghlSyncError: encodeSyncError(
            `GHL contact creation attempt ${attemptedAt.toISOString()} may have reached GHL for batch ${batchId}, session ${sessionId}, customer ${clientId}. Reconcile before retrying.`,
            false,
          ),
        });
        await tx.ghlSyncEvent.create({
          data: {
            demoSessionId: sessionId,
            eventType: "demo_sync",
            status: "contact_creation_attempt",
            message: `GHL contact creation attempt for batch ${batchId}, customer ${clientId}, at ${attemptedAt.toISOString()}.`,
          },
        });
        return true;
      });
      if (!claimed) {
        throw new CreationNeedsReconciliationError(RECONCILIATION_REQUIRED);
      }

      let createdId: string;
      try {
        const created = await stagedContactApi.createContact({
          ...(input.firstName ? { firstName: input.firstName } : {}),
          ...(input.lastName ? { lastName: input.lastName } : {}),
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {}),
        });
        createdId = created.id;
      } catch (error) {
        if (error instanceof GhlDuplicateContactError) {
          await clearContactCreationAttempt(sessionId, batchId, clientId);
          throw new ContactNeedsReviewError(
            "duplicate_on_create",
            "GHL rejected the new contact as a duplicate. Review the matching contact before syncing.",
          );
        }
        if (isDefinitiveRejection(error)) {
          await clearContactCreationAttempt(sessionId, batchId, clientId);
          throw error;
        }
        throw new CreationNeedsReconciliationError(RECONCILIATION_REQUIRED);
      }

      const createdContact = await stagedContactApi.getContact(createdId);
      if (!createdContact || createdContact.locationId !== stagedContactApi.locationId()) {
        throw new CreationNeedsReconciliationError(RECONCILIATION_REQUIRED);
      }
      await assertContactAvailableToClient(db, clientId, createdId);
      try {
        await persistResolvedNewContact(sessionId, batchId, clientId, createdId);
      } catch (error) {
        if (error instanceof ContactNeedsReviewError) throw error;
        throw new CreationNeedsReconciliationError(RECONCILIATION_REQUIRED);
      }
      return { id: createdId };
    },

    async saveContactId(clientId, ghlContactId) {
      await assertContactAvailableToClient(db, clientId, ghlContactId);
      await persistClientContact(db, clientId, ghlContactId);
      await db.golfClient.update({
        where: { id: clientId },
        data: { ghlLastSyncedAt: new Date(), ghlSyncStatus: "contact_resolved", ghlSyncError: null },
      });
    },

    validateOpportunity: validateOpportunitySelection,
    createOpportunity: createGolfDemoOpportunity,

    async ensureOpportunityId(sessionId, batchId, contactId, create) {
      const claimed = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM DemoSession WHERE id = ${sessionId} FOR UPDATE`;
        const row = await tx.demoSession.findUniqueOrThrow({
          where: { id: sessionId },
          select: { ghlOpportunityId: true, ghlSyncState: true },
        });
        if (row.ghlOpportunityId) return { existingId: row.ghlOpportunityId };
        const state = readSyncState(row.ghlSyncState);
        if (state.opportunity) {
          throw new CreationNeedsReconciliationError(RECONCILIATION_REQUIRED);
        }
        const attemptedAt = new Date().toISOString();
        const next: StagedSyncState = {
          ...state,
          opportunity: {
            status: "creating",
            batchId,
            contactId,
            attemptedAt,
          },
        };
        await tx.demoSession.update({
          where: { id: sessionId },
          data: {
            ghlSyncState: stateValue(next),
            ghlSyncStatus: "failed",
            ghlSyncError: encodeSyncError(
              `GHL opportunity creation attempt ${attemptedAt} may have reached GHL for batch ${batchId}, DemoSession ${sessionId}, and contact ${contactId}. Reconcile before retrying.`,
              false,
            ),
          },
        });
        await tx.ghlSyncEvent.create({
          data: {
            demoSessionId: sessionId,
            ghlContactId: contactId,
            eventType: "demo_sync",
            status: "opportunity_creation_attempt",
            message: `GHL opportunity creation attempt for batch ${batchId}, DemoSession ${sessionId}, contact ${contactId}, at ${attemptedAt}.`,
          },
        });
        return { existingId: null };
      }, { maxWait: 10_000, timeout: 30_000 });
      if (claimed.existingId) return claimed.existingId;

      let createdId: string;
      try {
        createdId = await create();
      } catch (error) {
        if (isDefinitiveRejection(error)) {
          await clearOpportunityCreationAttempt(sessionId);
          throw error;
        }
        throw new CreationNeedsReconciliationError(RECONCILIATION_REQUIRED);
      }

      try {
        return await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM DemoSession WHERE id = ${sessionId} FOR UPDATE`;
          const row = await tx.demoSession.findUniqueOrThrow({
            where: { id: sessionId },
            select: { ghlOpportunityId: true, ghlSyncState: true },
          });
          if (row.ghlOpportunityId) return row.ghlOpportunityId;
          const state = readSyncState(row.ghlSyncState);
          const rest = withoutOpportunity(state);
          await tx.demoSession.update({
            where: { id: sessionId },
            data: {
              ghlOpportunityId: createdId,
              ghlSyncState: stateValue(rest),
              ghlSyncStatus: "contact_resolved",
              ghlSyncError: null,
            },
          });
          return createdId;
        }, { maxWait: 10_000, timeout: 30_000 });
      } catch {
        throw new CreationNeedsReconciliationError(RECONCILIATION_REQUIRED);
      }
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
          ghlSyncState: Prisma.DbNull,
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
