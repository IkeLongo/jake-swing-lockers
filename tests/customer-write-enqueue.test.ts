import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClientIdentity } from "../lib/imports/new-customer-review";
import {
  createGolfClientIfUnique,
  updateGolfClientIfUnique,
} from "../lib/imports/new-customer-review-store";
import type { PrismaClient } from "../app/generated/prisma/client";
import { attemptCustomerSync } from "../lib/ghl/attemptCustomerSync";

interface FakeGolfClient extends ClientIdentity {
  ghlContactId: string | null;
  ghlContactCreationState: unknown;
}

interface FakeSyncState {
  golfClientId: number;
  desiredVersion: number;
  syncedVersion: number;
  workStatus: string;
  contactVerificationStatus: string;
  verifiedGhlLocationId: string | null;
  contactVerifiedAt: Date | null;
  attemptCount: number;
  nextAttemptAt: Date | null;
  lastAttemptAt: Date | null;
  claimToken: string | null;
  claimedVersion: number | null;
  leaseExpiresAt: Date | null;
  creationAttemptId: string | null;
  creationAttemptVersion: number | null;
  creationAttemptStatus: string | null;
  creationAttemptedAt: Date | null;
  lastErrorCode: string | null;
  lastError: string | null;
  lastSyncedSnapshot: unknown;
  createdAt: Date;
  updatedAt: Date;
}

function fakeDatabase(options: {
  clients?: FakeGolfClient[];
  syncStates?: FakeSyncState[];
  failSyncStateCreate?: boolean;
} = {}) {
  let clients = new Map(options.clients?.map((row) => [row.id, { ...row }]) ?? []);
  let syncStates = new Map(
    options.syncStates?.map((row) => [row.golfClientId, { ...row }]) ?? [],
  );
  let nextId = Math.max(0, ...clients.keys()) + 1;
  let clientCreateCount = 0;
  let clientUpdateCount = 0;
  let syncStateCreateCount = 0;
  let syncStateUpdateCount = 0;
  let transactionActive = false;

  const tx = {
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const query = strings.join("?");
      if (query.includes("FROM GolfClient WHERE id")) {
        const id = Number(values[0]);
        return clients.has(id) ? [{ id }] : [];
      }
      return [];
    },
    golfClient: {
      async findUnique(args: { where: { id: number } }) {
        return clients.get(args.where.id) ?? null;
      },
      async findMany() {
        return [...clients.values()];
      },
      async create(args: { data: Record<string, unknown> }) {
        clientCreateCount += 1;
        const row: FakeGolfClient = {
          id: nextId++,
          firstName: (args.data.firstName as string | null) ?? null,
          lastName: (args.data.lastName as string | null) ?? null,
          email: (args.data.email as string | null) ?? null,
          phone: (args.data.phone as string | null) ?? null,
          ghlContactId: null,
          ghlContactCreationState: null,
        };
        clients.set(row.id, row);
        return { ...row };
      },
      async update(args: { where: { id: number }; data: Partial<FakeGolfClient> }) {
        clientUpdateCount += 1;
        const current = clients.get(args.where.id);
        if (!current) throw new Error("client not found");
        const updated = { ...current, ...args.data };
        clients.set(updated.id, updated);
        return { ...updated };
      },
    },
    golfClientSyncState: {
      async findUnique(args: { where: { golfClientId: number } }) {
        return syncStates.get(args.where.golfClientId) ?? null;
      },
      async create(args: { data: Record<string, unknown> }) {
        syncStateCreateCount += 1;
        if (options.failSyncStateCreate) throw new Error("outbox create failed");
        const row: FakeSyncState = {
          golfClientId: args.data.golfClientId as number,
          desiredVersion: args.data.desiredVersion as number,
          syncedVersion: args.data.syncedVersion as number,
          workStatus: args.data.workStatus as string,
          contactVerificationStatus: args.data.contactVerificationStatus as string,
          verifiedGhlLocationId: null,
          contactVerifiedAt: null,
          attemptCount: 0,
          nextAttemptAt: null,
          lastAttemptAt: null,
          claimToken: null,
          claimedVersion: null,
          leaseExpiresAt: null,
          creationAttemptId: null,
          creationAttemptVersion: null,
          creationAttemptStatus: null,
          creationAttemptedAt: null,
          lastErrorCode: (args.data.lastErrorCode as string | undefined) ?? null,
          lastError: (args.data.lastError as string | undefined) ?? null,
          lastSyncedSnapshot: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        syncStates.set(row.golfClientId, row);
        return { desiredVersion: row.desiredVersion, workStatus: row.workStatus };
      },
      async update(args: {
        where: { golfClientId: number };
        data: { desiredVersion: { increment: number }; workStatus?: string };
      }) {
        syncStateUpdateCount += 1;
        const current = syncStates.get(args.where.golfClientId);
        if (!current) throw new Error("sync state not found");
        const updated = {
          ...current,
          desiredVersion: current.desiredVersion + args.data.desiredVersion.increment,
          ...(args.data.workStatus ? { workStatus: args.data.workStatus } : {}),
        };
        syncStates.set(updated.golfClientId, updated);
        return { desiredVersion: updated.desiredVersion, workStatus: updated.workStatus };
      },
    },
  };

  const db = {
    async $transaction<T>(callback: (transaction: typeof tx) => Promise<T>) {
      transactionActive = true;
      const previousClients = new Map(
        [...clients.entries()].map(([id, row]) => [id, { ...row }]),
      );
      const previousSyncStates = new Map(
        [...syncStates.entries()].map(([id, row]) => [id, { ...row }]),
      );
      const previousNextId = nextId;
      try {
        return await callback(tx);
      } catch (error) {
        clients = previousClients;
        syncStates = previousSyncStates;
        nextId = previousNextId;
        throw error;
      } finally {
        transactionActive = false;
      }
    },
  } as unknown as PrismaClient;

  return {
    db,
    get transactionActive() { return transactionActive; },
    get clients() {
      return [...clients.values()];
    },
    get syncStates() {
      return [...syncStates.values()];
    },
    get clientCreateCount() {
      return clientCreateCount;
    },
    get clientUpdateCount() {
      return clientUpdateCount;
    },
    get syncStateCreateCount() {
      return syncStateCreateCount;
    },
    get syncStateUpdateCount() {
      return syncStateUpdateCount;
    },
  };
}

function syncState(
  golfClientId: number,
  overrides: Partial<FakeSyncState> = {},
): FakeSyncState {
  return {
    golfClientId,
    desiredVersion: 3,
    syncedVersion: 2,
    workStatus: "pending",
    contactVerificationStatus: "unverified",
    verifiedGhlLocationId: null,
    contactVerifiedAt: null,
    attemptCount: 0,
    nextAttemptAt: null,
    lastAttemptAt: null,
    claimToken: null,
    claimedVersion: null,
    leaseExpiresAt: null,
    creationAttemptId: null,
    creationAttemptVersion: null,
    creationAttemptStatus: null,
    creationAttemptedAt: null,
    lastErrorCode: null,
    lastError: null,
    lastSyncedSnapshot: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

const newCustomer = {
  firstName: "Ann",
  lastName: "Lee",
  email: " ANN@example.com ",
  phone: "(210) 555-0100",
};

const existingCustomer: FakeGolfClient = {
  id: 1,
  firstName: "Ann",
  lastName: "Lee",
  email: "ann@example.com",
  phone: "+12105550100",
  ghlContactId: null,
  ghlContactCreationState: null,
};

test("creation and initial enqueue share one transaction", async () => {
  const h = fakeDatabase();
  const result = await createGolfClientIfUnique(h.db, newCustomer);

  assert.equal(result.status, "created");
  assert.equal(h.clients.length, 1);
  assert.equal(h.syncStates.length, 1);
  assert.equal(h.syncStates[0]?.desiredVersion, 1);
  assert.equal(h.syncStates[0]?.syncedVersion, 0);
  assert.equal(h.syncStates[0]?.workStatus, "pending");
  assert.equal(h.syncStateCreateCount, 1);
});

test("customer creation and profile updates await processing after commit", async () => {
  const h = fakeDatabase();
  const seen: number[] = [];
  const attempt = async (id: number) => {
    assert.equal(h.transactionActive, false);
    assert.ok(h.syncStates.find((state) => state.golfClientId === id));
    seen.push(id);
    return "synced" as const;
  };
  const created = await createGolfClientIfUnique(h.db, newCustomer, attempt);
  assert.equal(created.status === "created" && created.customerSync, "synced");
  assert.deepEqual(seen, [1]);
  const updated = await updateGolfClientIfUnique(h.db, 1, { firstName: "Anne" }, attempt);
  assert.equal(updated.status === "updated" && updated.customerSync, "synced");
  assert.deepEqual(seen, [1, 1]);
});

test("the create response waits for the post-commit sync attempt", async () => {
  const h = fakeDatabase();
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const entered = new Promise<void>((resolve) => { started = resolve; });
  let completed = false;
  const resultPromise = createGolfClientIfUnique(h.db, newCustomer, async () => {
    assert.equal(h.transactionActive, false);
    started();
    await gate;
    return "pending";
  }).then((result) => {
    completed = true;
    return result;
  });
  await entered;
  assert.equal(completed, false);
  assert.equal(h.syncStates[0]?.workStatus, "pending");
  release();
  const result = await resultPromise;
  assert.equal(result.status === "created" && result.customerSync, "pending");
});

test("failed immediate processing leaves the committed customer and queued work intact", async () => {
  const h = fakeDatabase();
  const result = await createGolfClientIfUnique(h.db, newCustomer, (id) =>
    attemptCustomerSync(id, async () => ({ status: "retry_scheduled", message: "retry later" })),
  );
  assert.equal(result.status === "created" && result.customerSync, "pending");
  assert.equal(h.clients.length, 1);
  assert.equal(h.syncStates[0]?.workStatus, "pending");
});

test("unexpected immediate processor errors do not undo a committed customer", async () => {
  const h = fakeDatabase();
  const result = await createGolfClientIfUnique(h.db, newCustomer, (id) =>
    attemptCustomerSync(id, async () => { throw new Error("processor failed"); }),
  );
  assert.equal(result.status === "created" && result.customerSync, "needs_reconciliation");
  assert.equal(h.clients.length, 1);
  assert.equal(h.syncStates[0]?.workStatus, "pending");
});

test("relevant profile changes enqueue only when normalized identity changes", async () => {
  const h = fakeDatabase({
    clients: [existingCustomer],
    syncStates: [syncState(existingCustomer.id)],
  });
  const result = await updateGolfClientIfUnique(h.db, existingCustomer.id, {
    firstName: "Anne",
    email: "NEW@example.com ",
  });

  assert.equal(result.status, "updated");
  assert.equal(h.clients[0]?.firstName, "Anne");
  assert.equal(h.clients[0]?.email, "new@example.com");
  assert.equal(h.syncStates[0]?.desiredVersion, 4);
  assert.equal(h.syncStateUpdateCount, 1);
});

test("no-op and normalization-equivalent updates do not enqueue", async () => {
  const h = fakeDatabase({
    clients: [existingCustomer],
    syncStates: [syncState(existingCustomer.id)],
  });
  const result = await updateGolfClientIfUnique(h.db, existingCustomer.id, {
    firstName: "Ann",
    email: " ANN@example.com ",
    phone: "(210) 555-0100",
  });

  assert.equal(result.status, "updated");
  assert.equal(h.clientUpdateCount, 0);
  assert.equal(h.syncStateUpdateCount, 0);
  assert.equal(h.syncStates[0]?.desiredVersion, 3);
});

test("normalization-only persistence does not create sync work", async () => {
  const legacyCustomer = { ...existingCustomer, email: " ANN@example.com " };
  const h = fakeDatabase({
    clients: [legacyCustomer],
    syncStates: [syncState(legacyCustomer.id)],
  });
  const result = await updateGolfClientIfUnique(h.db, legacyCustomer.id, {
    email: "ann@example.com",
  });

  assert.equal(result.status, "updated");
  assert.equal(h.clients[0]?.email, "ann@example.com");
  assert.equal(h.clientUpdateCount, 1);
  assert.equal(h.syncStateUpdateCount, 0);
});

test("duplicate customer creation is rejected without enqueue", async () => {
  const h = fakeDatabase({ clients: [existingCustomer] });
  const result = await createGolfClientIfUnique(h.db, {
    ...newCustomer,
    email: "ann@example.com",
  });

  assert.equal(result.status, "duplicate");
  assert.equal(h.clientCreateCount, 0);
  assert.equal(h.syncStateCreateCount, 0);
});

test("duplicate profile update is rejected without enqueue", async () => {
  const other: FakeGolfClient = {
    ...existingCustomer,
    id: 2,
    email: "new@example.com",
  };
  const h = fakeDatabase({
    clients: [existingCustomer, other],
    syncStates: [syncState(existingCustomer.id)],
  });
  const result = await updateGolfClientIfUnique(h.db, existingCustomer.id, {
    email: "new@example.com",
  });

  assert.equal(result.status, "duplicate");
  assert.equal(h.clientUpdateCount, 0);
  assert.equal(h.syncStateUpdateCount, 0);
  assert.equal(h.syncStates[0]?.desiredVersion, 3);
});

test("outbox failure rolls customer creation back with its transaction", async () => {
  const h = fakeDatabase({ failSyncStateCreate: true });
  await assert.rejects(createGolfClientIfUnique(h.db, newCustomer), /outbox create failed/);
  assert.equal(h.clients.length, 0);
  assert.equal(h.syncStates.length, 0);
});
