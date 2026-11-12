import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@/app/generated/prisma/client";
import { getBatchGhlApprovalStatus } from "@/lib/imports/ghl-approval-gate";
import {
  evaluateApproval,
  resolveBatchLocalIdentity,
} from "@/lib/imports/ghl-contact-approval";
import { discoverStagedContacts } from "./discoverStagedContacts";
import { computeDiscoverySignature } from "./discoverySignature";
import { stagedContactApi } from "./stagedContactApi";
import { decodeSyncError, isContactApprovalRecoveryError } from "./syncErrorMarker";

const select = {
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
  ghlContactDecision: true,
  approvedGhlContactId: true,
  ghlContactApprovalSignature: true,
  ghlContactApprovedAt: true,
  ghlContactApprovedByStaffUserId: true,
  ghlContactReviewSnapshot: true,
  demoSession: {
    select: {
      id: true,
      clientId: true,
      status: true,
      ghlSyncStatus: true,
      ghlSyncError: true,
      ghlSyncState: true,
      ghlOpportunityId: true,
      ghlLockerReadyTagAddedAt: true,
      client: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          ghlContactId: true,
          ghlContactCreationState: true,
          syncState: {
            select: {
              creationAttemptId: true,
              creationAttemptVersion: true,
              creationAttemptStatus: true,
              creationAttemptedAt: true,
            },
          },
        },
      },
    },
  },
} as const;

type Batch = Prisma.ImportBatchGetPayload<{ select: typeof select }>;

function eligible(batch: Batch | null, claim?: string): batch is Batch & {
  demoSession: NonNullable<Batch["demoSession"]>;
} {
  const session = batch?.demoSession;
  const client = session?.client;
  if (
    !batch || !session || !client ||
    batch.parserMode !== "trackman-result" || batch.status !== "finalized" ||
    session.status !== "finalized" || session.ghlSyncStatus !== "failed" ||
    !isContactApprovalRecoveryError(decodeSyncError(session.ghlSyncError).message) ||
    !client.ghlContactId || client.ghlContactCreationState !== null ||
    (batch.customerResolution === "existing" && batch.selectedGolfClientId !== client.id) ||
    (batch.customerResolution === "new" && batch.selectedGolfClientId !== null) ||
    !["existing", "new"].includes(batch.customerResolution ?? "") ||
    !["existing", "new"].includes(batch.ghlContactDecision ?? "") ||
    session.ghlLockerReadyTagAddedAt !== null ||
    (batch.opportunityResolution === "new" && session.ghlOpportunityId !== null) ||
    (batch.opportunityResolution === "existing" &&
      (!batch.selectedGhlOpportunityId || session.ghlOpportunityId !== batch.selectedGhlOpportunityId)) ||
    !["existing", "new"].includes(batch.opportunityResolution ?? "") ||
    (batch.opportunityResolution === "new" && batch.selectedGhlOpportunityId !== null)
  ) return false;
  const sync = client.syncState;
  if (sync && Object.values(sync).some((value) => value !== null)) return false;
  const state = session.ghlSyncState;
  if (state !== null) {
    if (typeof state !== "object" || Array.isArray(state) || state.version !== 1) return false;
    if (Object.keys(state).some((key) => key !== "version" && key !== "fittingClaim")) return false;
    if (claim) {
      const marker = state.fittingClaim;
      if (!marker || typeof marker !== "object" || Array.isArray(marker) || marker.token !== claim) return false;
    } else if (state.fittingClaim !== undefined) return false;
  } else if (claim) return false;
  const status = getBatchGhlApprovalStatus(batch, client);
  return status === "stale" ||
    batch.ghlContactDecision === "new" ||
    batch.approvedGhlContactId !== client.ghlContactId;
}

function fingerprint(batch: Batch, discoverySignature: string): string {
  const session = batch.demoSession!;
  const stableSession = { ...session, ghlSyncState: null };
  return createHash("sha256").update(JSON.stringify({
    ...batch,
    demoSession: stableSession,
    discoverySignature,
  })).digest("hex");
}

async function load(db: PrismaClient | Prisma.TransactionClient, batchId: number) {
  return db.importBatch.findUnique({ where: { id: batchId }, select });
}

export async function inspectFittingContactRecovery(
  db: PrismaClient,
  batchId: number,
  claim?: string,
) {
  const batch = await load(db, batchId);
  if (!eligible(batch, claim)) return null;
  const client = batch.demoSession.client;
  const discovery = await discoverStagedContacts({
    api: stagedContactApi,
    findLinkedClients: (ids) => db.golfClient.findMany({
      where: { ghlContactId: { in: ids } },
      select: { id: true, firstName: true, lastName: true, ghlContactId: true },
    }),
  }, {
    identity: client,
    savedContactId: client.ghlContactId,
    ownClientId: client.id,
  });
  const contact = discovery.candidates[0];
  if (
    discovery.savedLink.status !== "verified" || discovery.candidates.length !== 1 ||
    !contact || contact.id !== client.ghlContactId || !contact.locationVerified ||
    discovery.unsearchable.length > 0 ||
    Object.entries(discovery.flags).some(([key, value]) => key !== "identityConflict" && value)
  ) return null;
  const identity = resolveBatchLocalIdentity(batch, client);
  if (!identity) return null;
  const discoverySignature = computeDiscoverySignature(discovery);
  const outcome = evaluateApproval({
    identity,
    discovery,
    request: {
      action: "approve_existing",
      contactId: contact.id,
      discoverySignature,
      acknowledgedDiscrepancies: contact.discrepancies,
    },
  });
  if (!outcome.ok) return null;
  return {
    batch,
    outcome,
    fingerprint: fingerprint(batch, discoverySignature),
    contact,
  };
}

export async function confirmFittingContactRecovery(
  db: PrismaClient,
  batchId: number,
  staffUserId: number,
  claim: string,
  expectedFingerprint: string,
): Promise<boolean> {
  const inspected = await inspectFittingContactRecovery(db, batchId, claim);
  if (!inspected || inspected.fingerprint !== expectedFingerprint) return false;
  const { batch, outcome } = inspected;
  const session = batch.demoSession!;
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM GolfClient WHERE id = ${session.clientId} FOR UPDATE`;
    await tx.$queryRaw`SELECT golfClientId FROM GolfClientSyncState WHERE golfClientId = ${session.clientId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM DemoSession WHERE id = ${session.id} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM ImportBatch WHERE id = ${batchId} FOR UPDATE`;
    const current = await load(tx, batchId);
    if (!eligible(current, claim)) return false;
    if (fingerprint(current, inspected.outcome.snapshot.discoverySignature) !== expectedFingerprint) return false;
    const owner = await tx.golfClient.findUnique({
      where: { ghlContactId: outcome.approvedContactId! },
      select: { id: true },
    });
    if (!owner || owner.id !== session.clientId) return false;
    const staff = await tx.staffUser.findUnique({
      where: { id: staffUserId },
      select: { isActive: true },
    });
    if (!staff?.isActive) return false;
    await tx.importBatch.update({
      where: { id: batchId },
      data: {
        ghlContactDecision: outcome.decision,
        approvedGhlContactId: outcome.approvedContactId,
        ghlContactApprovalSignature: outcome.signature,
        ghlContactReviewSnapshot: {
          ...outcome.snapshot,
          candidates: outcome.snapshot.candidates.map((candidate) => ({ ...candidate })),
        },
        ghlContactApprovedAt: new Date(),
        ghlContactApprovedByStaffUserId: staffUserId,
      },
    });
    await tx.demoSession.update({
      where: { id: session.id },
      data: {
        ghlSyncStatus: "failed",
        ghlSyncError: "Contact approval updated. Retry CRM sync.",
      },
    });
    return true;
  }, { maxWait: 10_000, timeout: 30_000 });
}
