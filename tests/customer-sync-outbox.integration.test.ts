import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, describe, test } from "node:test";
import { Prisma } from "../app/generated/prisma/client";
import {
  CustomerSyncOutboxError,
  enqueueCustomerSync,
} from "../lib/ghl/customerSyncOutbox";
import {
  createGolfClientIfUnique,
  updateGolfClientIfUnique,
} from "../lib/imports/new-customer-review-store";
import {
  computeApprovalSignature,
  resolveBatchLocalIdentity,
  type GhlReviewSnapshot,
} from "../lib/imports/ghl-contact-approval";
import {
  finalizeStagedImport,
  type StagedFinalizeTx,
} from "../lib/imports/staged-finalization";
import { createPrismaStagedFinalizeDeps } from "../lib/imports/staged-finalization-store";
import type { ImportClubSummary } from "../app/generated/prisma/client";
import {
  assertCustomerSyncTestDatabaseIdentity,
  createCustomerSyncTestClient,
  getCustomerSyncTestDatabaseConfig,
} from "./helpers/customerSyncTestDatabase";
import type { CustomerSyncTestDatabaseConfig } from "./helpers/customerSyncTestDatabase";

const integrationSkip = process.env.DATABASE_URL_TEST
  ? false
  : "Set DATABASE_URL_TEST to the guarded local test database to run integration tests.";

describe(
  "customer sync outbox MySQL integration",
  { skip: integrationSkip },
  () => {
    let client: ReturnType<typeof createCustomerSyncTestClient> | null = null;
    let config: CustomerSyncTestDatabaseConfig;
    let databaseVerified = false;
    const fixtureIds: number[] = [];
    const batchIds: number[] = [];
    const sessionIds: number[] = [];
    const customerEmails: string[] = [];

    before(async () => {
      config = getCustomerSyncTestDatabaseConfig();
      client = createCustomerSyncTestClient(config);
      await assertCustomerSyncTestDatabaseIdentity(client, config);
      databaseVerified = true;
    });

    afterEach(async () => {
      if (!client || !databaseVerified) return;

      const sessions = sessionIds.splice(0);
      if (sessions.length > 0) {
        const clubs = await client.demoClubTest.findMany({
          where: { demoSessionId: { in: sessions } },
          select: { id: true },
        });
        const clubIds = clubs.map((club) => club.id);
        if (clubIds.length > 0) {
          await client.clubTestMetrics.deleteMany({
            where: { clubTestId: { in: clubIds } },
          });
          await client.demoClubTest.deleteMany({
            where: { id: { in: clubIds } },
          });
        }
        await client.demoSession.deleteMany({ where: { id: { in: sessions } } });
      }

      const batches = batchIds.splice(0);
      if (batches.length > 0) {
        await client.importRow.deleteMany({ where: { importBatchId: { in: batches } } });
        await client.importClubSummary.deleteMany({ where: { importBatchId: { in: batches } } });
        await client.importBatch.deleteMany({ where: { id: { in: batches } } });
      }

      const ids = fixtureIds.splice(0);
      const emails = customerEmails.splice(0);
      await client.golfClient.deleteMany({
        where: {
          OR: [
            ...(ids.length > 0 ? [{ id: { in: ids } }] : []),
            ...(emails.length > 0 ? [{ email: { in: emails } }] : []),
          ],
        },
      });
    });

    after(async () => {
      if (client) await client.$disconnect();
    });

    function customerData(
      extras: { ghlContactCreationState?: Prisma.InputJsonValue } = {},
    ) {
      const email = `customer-sync-${randomUUID()}@example.test`;
      customerEmails.push(email);
      return {
        firstName: "Customer Sync",
        lastName: "Integration Test",
        email,
        ...extras,
      };
    }

    async function createStagedImport(input: {
      customerResolution: "existing" | "new";
      customerId?: number;
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string | null;
    }) {
      assert.ok(client);
      const email = input.email ?? `staged-${randomUUID()}@example.test`;
      if (input.customerResolution === "new") customerEmails.push(email);
      const proposed = {
        customerResolution: input.customerResolution,
        selectedGolfClientId: input.customerId ?? null,
        proposedFirstName:
          input.customerResolution === "new" ? input.firstName ?? "Track" : null,
        proposedLastName:
          input.customerResolution === "new" ? input.lastName ?? "Player" : null,
        proposedEmail: input.customerResolution === "new" ? email : null,
        proposedPhone:
          input.customerResolution === "new" ? input.phone ?? null : null,
      };
      const selectedCustomer =
        input.customerResolution === "existing"
          ? {
              firstName: input.firstName ?? "Customer Sync",
              lastName: input.lastName ?? "Integration Test",
              email,
              phone: input.phone ?? null,
            }
          : null;
      const localIdentity = resolveBatchLocalIdentity(proposed, selectedCustomer);
      assert.ok(localIdentity);
      const snapshot: GhlReviewSnapshot = {
        v: 1,
        discoverySignature: "a".repeat(64),
        incomplete: false,
        candidates: [],
        acknowledgedDiscrepancies: [],
        acknowledgedCandidateIds: [],
      };
      const approvalSignature = computeApprovalSignature({
        identity: localIdentity,
        decision: "new",
        approvedContactId: null,
        snapshot,
      });

      const batch = await client.importBatch.create({
        data: {
          originalFileName: `customer-sync-${randomUUID()}.xlsx`,
          parserMode: "trackman-result",
          status: "reviewing",
          rowCount: 1,
          trackmanSessionDate: new Date("2026-10-10T12:00:00.000Z"),
          ...proposed,
          ghlContactDecision: "new",
          approvedGhlContactId: null,
          ghlContactApprovalSignature: approvalSignature,
          ghlContactApprovedAt: new Date("2026-10-10T12:00:00.000Z"),
          ghlContactApprovedByStaffUserId: 1,
          ghlContactReviewSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          opportunityResolution: "new",
          selectedGhlOpportunityId: null,
        },
        select: { id: true },
      });
      batchIds.push(batch.id);
      await client.importClubSummary.create({
        data: {
          importBatchId: batch.id,
          clubName: "7i Test",
          originalClubName: "7i Test",
          shotCount: 3,
          includeInReport: true,
        },
      });
      return { id: batch.id, email };
    }

    async function createCustomer() {
      assert.ok(client);
      const created = await client.golfClient.create({ data: customerData() });
      fixtureIds.push(created.id);
      return created;
    }

    async function enqueueInTransaction(
      golfClientId: number,
      reason: "created" | "profile_changed" = "profile_changed",
    ) {
      assert.ok(client);
      return client.$transaction((tx) =>
        enqueueCustomerSync(tx, { golfClientId, reason }),
      );
    }

    test("staged finalization enqueues only the newly created customer", async () => {
      assert.ok(client);
      const staged = await createStagedImport({
        customerResolution: "new",
        firstName: "TrackMan",
        lastName: "Player",
      });
      const result = await finalizeStagedImport(
        createPrismaStagedFinalizeDeps(client),
        { batchId: staged.id, salesRep: "Integration Test" },
      );

      assert.equal(result.ok, true);
      if (!result.ok) return;
      fixtureIds.push(result.golfClientId);
      sessionIds.push(result.demoSessionId);
      const state = await client.golfClientSyncState.findUniqueOrThrow({
        where: { golfClientId: result.golfClientId },
      });
      assert.equal(state.desiredVersion, 1);
      assert.equal(state.syncedVersion, 0);
      assert.equal(state.workStatus, "pending");
      assert.equal(
        (await client.importBatch.findUnique({
          where: { id: staged.id },
          select: { demoSessionId: true, status: true },
        }))?.status,
        "finalized",
      );
    });

    test("staged finalization does not enqueue when it attaches an existing customer", async () => {
      assert.ok(client);
      const customer = await createCustomer();
      const staged = await createStagedImport({
        customerResolution: "existing",
        customerId: customer.id,
        email: customer.email!,
      });
      const result = await finalizeStagedImport(
        createPrismaStagedFinalizeDeps(client),
        { batchId: staged.id, salesRep: "Integration Test" },
      );

      assert.equal(result.ok, true);
      if (!result.ok) return;
      sessionIds.push(result.demoSessionId);
      assert.equal(
        await client.golfClientSyncState.findUnique({
          where: { golfClientId: customer.id },
        }),
        null,
      );
    });

    test("duplicate customer rejection does not enqueue or create a session", async () => {
      assert.ok(client);
      const customer = await createCustomer();
      const staged = await createStagedImport({
        customerResolution: "new",
        firstName: "Duplicate",
        lastName: "Customer",
        email: customer.email!,
      });
      const result = await finalizeStagedImport(
        createPrismaStagedFinalizeDeps(client),
        { batchId: staged.id, salesRep: "Integration Test" },
      );

      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "duplicate_customer_unresolved");
      assert.equal(await client.golfClient.count({ where: { email: customer.email } }), 1);
      assert.equal(
        await client.golfClientSyncState.findUnique({
          where: { golfClientId: customer.id },
        }),
        null,
      );
      assert.equal(
        (await client.importBatch.findUnique({
          where: { id: staged.id },
          select: { demoSessionId: true },
        }))?.demoSessionId,
        null,
      );
    });

    test("enqueue and all staged writes roll back when finalization transaction fails", async () => {
      assert.ok(client);
      const staged = await createStagedImport({
        customerResolution: "new",
        firstName: "Rollback",
        lastName: "Customer",
      });
      const baseDeps = createPrismaStagedFinalizeDeps(client);
      const rollbackDeps = {
        ...baseDeps,
        transaction: <T,>(fn: (tx: StagedFinalizeTx<ImportClubSummary>) => Promise<T>) =>
          baseDeps.transaction(async (tx) => {
            await fn(tx);
            throw new Error("force finalization rollback");
          }),
      };

      await assert.rejects(
        finalizeStagedImport(rollbackDeps, {
          batchId: staged.id,
          salesRep: "Integration Test",
        }),
        /force finalization rollback/,
      );

      assert.equal(await client.golfClient.count({ where: { email: staged.email } }), 0);
      assert.equal(
        await client.golfClientSyncState.count({
          where: { client: { email: staged.email } },
        }),
        0,
      );
      assert.equal(await client.demoSession.count({ where: { importBatches: { some: { id: staged.id } } } }), 0);
      assert.equal(
        (await client.importBatch.findUnique({
          where: { id: staged.id },
          select: { demoSessionId: true, status: true },
        }))?.demoSessionId,
        null,
      );
    });

    test("customer creation and initial enqueue commit atomically", async () => {
      assert.ok(client);
      let golfClientId = 0;
      await client.$transaction(async (tx) => {
        const created = await tx.golfClient.create({ data: customerData() });
        golfClientId = created.id;
        fixtureIds.push(created.id);
        const result = await enqueueCustomerSync(tx, {
          golfClientId: created.id,
          reason: "created",
        });
        assert.deepEqual(result, { desiredVersion: 1, workStatus: "pending" });
      });

      const persisted = await client.golfClient.findUnique({
        where: { id: golfClientId },
        include: { syncState: true },
      });
      assert.ok(persisted);
      assert.equal(persisted.syncState?.desiredVersion, 1);
      assert.equal(persisted.syncState?.syncedVersion, 0);
      assert.equal(persisted.syncState?.workStatus, "pending");
    });

    test("customer creation helper commits its customer and enqueue together", async () => {
      assert.ok(client);
      const result = await createGolfClientIfUnique(client, {
        firstName: "Customer Sync",
        lastName: "Created Through Store",
        email: `customer-sync-${randomUUID()}@example.test`,
        phone: null,
      });
      assert.equal(result.status, "created");
      if (result.status !== "created") return;
      fixtureIds.push(result.client.id);

      const state = await client.golfClientSyncState.findUniqueOrThrow({
        where: { golfClientId: result.client.id },
      });
      assert.equal(state.desiredVersion, 1);
      assert.equal(state.syncedVersion, 0);
      assert.equal(state.workStatus, "pending");
    });

    test("customer profile update helper enqueues a changed normalized profile", async () => {
      assert.ok(client);
      const customer = await createCustomer();
      await enqueueInTransaction(customer.id, "created");

      const result = await updateGolfClientIfUnique(client, customer.id, {
        firstName: "Updated Customer",
        email: `updated-${randomUUID()}@example.test`,
      });
      assert.equal(result.status, "updated");

      const state = await client.golfClientSyncState.findUniqueOrThrow({
        where: { golfClientId: customer.id },
      });
      assert.equal(state.desiredVersion, 2);
    });

    test("no-op profile update does not increment the desired version", async () => {
      assert.ok(client);
      const customer = await client.golfClient.create({
        data: {
          firstName: "No-op Customer",
          lastName: "Normalization",
          email: `noop-${randomUUID()}@example.test`,
          phone: "+12105550100",
        },
      });
      fixtureIds.push(customer.id);
      await enqueueInTransaction(customer.id, "created");

      const result = await updateGolfClientIfUnique(client, customer.id, {
        firstName: "No-op Customer",
        email: ` ${customer.email!.toUpperCase()} `,
        phone: "(210) 555-0100",
      });
      assert.equal(result.status, "updated");
      const state = await client.golfClientSyncState.findUniqueOrThrow({
        where: { golfClientId: customer.id },
      });
      assert.equal(state.desiredVersion, 1);
    });

    test("duplicate customer create and profile update do not enqueue", async () => {
      assert.ok(client);
      const customer = await createCustomer();
      await enqueueInTransaction(customer.id, "created");

      const duplicateCreate = await createGolfClientIfUnique(client, {
        firstName: "Duplicate",
        lastName: "Customer",
        email: customer.email,
        phone: null,
      });
      assert.equal(duplicateCreate.status, "duplicate");

      const other = await createCustomer();
      const duplicateUpdate = await updateGolfClientIfUnique(client, other.id, {
        email: customer.email,
      });
      assert.equal(duplicateUpdate.status, "duplicate");
      assert.equal(
        await client.golfClientSyncState.findUnique({
          where: { golfClientId: other.id },
        }),
        null,
      );
      const originalState = await client.golfClientSyncState.findUniqueOrThrow({
        where: { golfClientId: customer.id },
      });
      assert.equal(originalState.desiredVersion, 1);
    });

    test("transaction rollback removes both customer and sync state", async () => {
      assert.ok(client);
      let golfClientId = 0;
      await assert.rejects(
        client.$transaction(async (tx) => {
          const created = await tx.golfClient.create({ data: customerData() });
          golfClientId = created.id;
          fixtureIds.push(created.id);
          await enqueueCustomerSync(tx, {
            golfClientId: created.id,
            reason: "created",
          });
          throw new Error("force transaction rollback");
        }),
        /force transaction rollback/,
      );

      assert.equal(await client.golfClient.findUnique({ where: { id: golfClientId } }), null);
      assert.equal(
        await client.golfClientSyncState.findUnique({ where: { golfClientId } }),
        null,
      );
    });

    test("concurrent enqueues preserve every desired-version increment", async () => {
      const customer = await createCustomer();
      await enqueueInTransaction(customer.id, "created");

      await Promise.all(
        Array.from({ length: 8 }, () => enqueueInTransaction(customer.id)),
      );

      const state = await client!.golfClientSyncState.findUniqueOrThrow({
        where: { golfClientId: customer.id },
      });
      assert.equal(state.desiredVersion, 9);
      assert.equal(state.syncedVersion, 0);
    });

    test("concurrent initialization creates one row and preserves increments", async () => {
      const customer = await createCustomer();
      await Promise.all(
        Array.from({ length: 8 }, () => enqueueInTransaction(customer.id)),
      );

      const [rowCount, state] = await Promise.all([
        client!.golfClientSyncState.count({ where: { golfClientId: customer.id } }),
        client!.golfClientSyncState.findUniqueOrThrow({
          where: { golfClientId: customer.id },
        }),
      ]);
      assert.equal(rowCount, 1);
      assert.equal(state.desiredVersion, 8);
    });

    test("blocked states remain blocked", async () => {
      for (const workStatus of ["needs_review", "needs_reconciliation"] as const) {
        const customer = await createCustomer();
        await client!.golfClientSyncState.create({
          data: {
            golfClientId: customer.id,
            desiredVersion: 4,
            syncedVersion: 2,
            workStatus,
            lastErrorCode: "preserve-me",
          },
        });

        const result = await enqueueInTransaction(customer.id);
        const state = await client!.golfClientSyncState.findUniqueOrThrow({
          where: { golfClientId: customer.id },
        });
        assert.equal(result.workStatus, workStatus);
        assert.equal(state.workStatus, workStatus);
        assert.equal(state.desiredVersion, 5);
        assert.equal(state.syncedVersion, 2);
        assert.equal(state.lastErrorCode, "preserve-me");
      }
    });

    test("active processing claim and lease remain intact", async () => {
      const customer = await createCustomer();
      const leaseExpiresAt = new Date("2030-01-01T00:00:00.000Z");
      await client!.golfClientSyncState.create({
        data: {
          golfClientId: customer.id,
          workStatus: "processing",
          desiredVersion: 2,
          claimedVersion: 1,
          claimToken: "active-test-claim",
          leaseExpiresAt,
        },
      });

      await enqueueInTransaction(customer.id);

      const state = await client!.golfClientSyncState.findUniqueOrThrow({
        where: { golfClientId: customer.id },
      });
      assert.equal(state.workStatus, "processing");
      assert.equal(state.desiredVersion, 3);
      assert.equal(state.claimedVersion, 1);
      assert.equal(state.claimToken, "active-test-claim");
      assert.equal(state.leaseExpiresAt?.getTime(), leaseExpiresAt.getTime());
    });

    test("historical known and malformed creation claims initialize blocked", async () => {
      const claims: Prisma.InputJsonValue[] = [
        {
          version: 1,
          status: "creating",
          sessionId: 7,
          batchId: 11,
          attemptedAt: "2026-11-01T00:00:00.000Z",
        },
        { version: 2, status: "creating" },
      ];

      for (const claim of claims) {
        const customer = await client!.golfClient.create({
          data: customerData({ ghlContactCreationState: claim }),
        });
        fixtureIds.push(customer.id);
        const result = await enqueueInTransaction(customer.id);
        const state = await client!.golfClientSyncState.findUniqueOrThrow({
          where: { golfClientId: customer.id },
        });
        assert.equal(result.workStatus, "needs_reconciliation");
        assert.equal(state.workStatus, "needs_reconciliation");
        assert.ok(customer.ghlContactCreationState);
      }
    });

    test("missing customer cannot create an orphan sync-state row", async () => {
      const golfClientId = 2_147_483_647;
      assert.equal(await client!.golfClient.findUnique({ where: { id: golfClientId } }), null);
      await assert.rejects(
        enqueueInTransaction(golfClientId),
        CustomerSyncOutboxError,
      );
      assert.equal(
        await client!.golfClientSyncState.findUnique({ where: { golfClientId } }),
        null,
      );
    });
  },
);
