import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CustomerSyncOutboxError,
  enqueueCustomerSync,
  type CustomerSyncWorkStatus,
} from "../lib/ghl/customerSyncOutbox";

interface FakeClient {
  id: number;
  ghlContactCreationState: unknown;
  ghlSyncStatus: string | null;
  ghlContactId: string | null;
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

function state(overrides: Partial<FakeSyncState> = {}): FakeSyncState {
  return {
    golfClientId: 7,
    desiredVersion: 4,
    syncedVersion: 3,
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

function cloneState(value: FakeSyncState | null): FakeSyncState | null {
  return value ? { ...value } : null;
}

function makeHarness(options: {
  clientExists?: boolean;
  client?: Partial<FakeClient>;
  syncState?: FakeSyncState | null;
} = {}) {
  const client: FakeClient = {
    id: 7,
    ghlContactCreationState: null,
    ghlSyncStatus: null,
    ghlContactId: null,
    ...options.client,
  };
  const clientExists = options.clientExists ?? true;
  let persistedState = cloneState(options.syncState ?? null);
  let lockTail: Promise<void> = Promise.resolve();
  const lockSql: string[] = [];
  let createCount = 0;

  async function transaction<T>(callback: (tx: never) => Promise<T>): Promise<T> {
    let localState = cloneState(persistedState);
    let acquired = false;
    let releaseLock = () => {};

    const tx = {
      async $queryRaw(strings: TemplateStringsArray) {
        lockSql.push(strings.join(" "));
        if (!clientExists) return [];

        const previous = lockTail;
        let release!: () => void;
        lockTail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        acquired = true;
        releaseLock = release;
        localState = cloneState(persistedState);
        return [{ id: client.id }];
      },
      golfClient: {
        async findUnique() {
          return clientExists
            ? { ghlContactCreationState: client.ghlContactCreationState }
            : null;
        },
      },
      golfClientSyncState: {
        async findUnique() {
          return cloneState(localState);
        },
        async create(args: { data: Record<string, unknown> }) {
          if (localState) throw new Error("duplicate sync-state row");
          createCount += 1;
          localState = state(args.data as Partial<FakeSyncState>);
          return {
            desiredVersion: localState.desiredVersion,
            workStatus: localState.workStatus,
          };
        },
        async update(args: { data: Record<string, unknown> }) {
          if (!localState) throw new Error("sync-state row not found");
          const increment = args.data.desiredVersion as { increment: number };
          localState = {
            ...localState,
            ...args.data,
            desiredVersion: localState.desiredVersion + increment.increment,
          } as FakeSyncState;
          return {
            desiredVersion: localState.desiredVersion,
            workStatus: localState.workStatus,
          };
        },
      },
    };

    try {
      const result = await callback(tx as never);
      if (acquired) persistedState = cloneState(localState);
      return result;
    } finally {
      releaseLock();
    }
  }

  return {
    transaction,
    get client() {
      return client;
    },
    get syncState() {
      return cloneState(persistedState);
    },
    get createCount() {
      return createCount;
    },
    lockSql,
  };
}

function enqueue(
  harness: ReturnType<typeof makeHarness>,
  reason: "created" | "profile_changed" = "profile_changed",
) {
  return harness.transaction((tx) =>
    enqueueCustomerSync(tx as never, { golfClientId: 7, reason }),
  );
}

function statusOf(harness: ReturnType<typeof makeHarness>): CustomerSyncWorkStatus | null {
  const value = harness.syncState?.workStatus;
  return value ? (value as CustomerSyncWorkStatus) : null;
}

test("new customer initializes one pending unverified sync row at version one", async () => {
  const h = makeHarness({
    client: { ghlSyncStatus: "synced", ghlContactId: "saved-contact" },
  });

  assert.deepEqual(await enqueue(h, "created"), {
    desiredVersion: 1,
    workStatus: "pending",
  });
  assert.equal(h.syncState?.syncedVersion, 0);
  assert.equal(h.syncState?.contactVerificationStatus, "unverified");
  assert.equal(h.syncState?.verifiedGhlLocationId, null);
  assert.equal(h.syncState?.contactVerifiedAt, null);
  assert.equal(h.createCount, 1);
});

test("existing customer increments the desired version", async () => {
  const h = makeHarness({ syncState: state() });
  assert.deepEqual(await enqueue(h), {
    desiredVersion: 5,
    workStatus: "pending",
  });
});

test("multiple profile edits coalesce into one row without losing increments", async () => {
  const h = makeHarness({ syncState: null });
  const results = await Promise.all([
    enqueue(h, "created"),
    enqueue(h),
    enqueue(h),
    enqueue(h),
  ]);

  assert.equal(h.createCount, 1);
  assert.equal(h.syncState?.desiredVersion, 4);
  assert.deepEqual(results.map((result) => result.desiredVersion).sort(), [1, 2, 3, 4]);
});

test("existing syncedVersion is preserved while a synced row becomes pending", async () => {
  const h = makeHarness({
    syncState: state({ workStatus: "synced", syncedVersion: 4, desiredVersion: 4 }),
  });
  const result = await enqueue(h);
  assert.deepEqual(result, { desiredVersion: 5, workStatus: "pending" });
  assert.equal(h.syncState?.syncedVersion, 4);
});

test("needs_review remains blocked", async () => {
  const h = makeHarness({
    syncState: state({ workStatus: "needs_review", lastErrorCode: "identity_conflict" }),
  });
  await enqueue(h);
  assert.equal(statusOf(h), "needs_review");
  assert.equal(h.syncState?.lastErrorCode, "identity_conflict");
});

test("needs_reconciliation remains blocked", async () => {
  const h = makeHarness({
    syncState: state({ workStatus: "needs_reconciliation", lastErrorCode: "unknown_create" }),
  });
  await enqueue(h);
  assert.equal(statusOf(h), "needs_reconciliation");
  assert.equal(h.syncState?.lastErrorCode, "unknown_create");
});

test("retryable failure retains its schedule and error context", async () => {
  const nextAttemptAt = new Date("2026-11-12T00:00:00Z");
  const h = makeHarness({
    syncState: state({
      workStatus: "retryable_failed",
      nextAttemptAt,
      lastErrorCode: "temporary_failure",
      lastError: "Retry later.",
    }),
  });
  await enqueue(h);
  assert.equal(statusOf(h), "retryable_failed");
  assert.equal(h.syncState?.desiredVersion, 5);
  assert.equal(h.syncState?.nextAttemptAt?.getTime(), nextAttemptAt.getTime());
  assert.equal(h.syncState?.lastErrorCode, "temporary_failure");
  assert.equal(h.syncState?.lastError, "Retry later.");
});

test("processing claim and lease remain intact while desired version advances", async () => {
  const leaseExpiresAt = new Date("2026-11-11T00:00:00Z");
  const h = makeHarness({
    syncState: state({
      workStatus: "processing",
      claimToken: "claim-1",
      claimedVersion: 4,
      leaseExpiresAt,
    }),
  });
  await enqueue(h);
  assert.equal(statusOf(h), "processing");
  assert.equal(h.syncState?.desiredVersion, 5);
  assert.equal(h.syncState?.claimToken, "claim-1");
  assert.equal(h.syncState?.claimedVersion, 4);
  assert.equal(h.syncState?.leaseExpiresAt?.getTime(), leaseExpiresAt.getTime());
});

test("contact verification metadata remains intact", async () => {
  const verifiedAt = new Date("2026-05-01T10:00:00Z");
  const h = makeHarness({
    syncState: state({
      contactVerificationStatus: "verified",
      verifiedGhlLocationId: "location-1",
      contactVerifiedAt: verifiedAt,
    }),
  });
  await enqueue(h);
  assert.equal(h.syncState?.contactVerificationStatus, "verified");
  assert.equal(h.syncState?.verifiedGhlLocationId, "location-1");
  assert.equal(h.syncState?.contactVerifiedAt?.getTime(), verifiedAt.getTime());
});

test("creation-attempt metadata and error context remain intact", async () => {
  const attemptedAt = new Date("2026-06-01T10:00:00Z");
  const h = makeHarness({
    syncState: state({
      workStatus: "pending",
      creationAttemptId: "attempt-1",
      creationAttemptVersion: 3,
      creationAttemptStatus: "unknown",
      creationAttemptedAt: attemptedAt,
      lastErrorCode: "creation_outcome_unknown",
      lastError: "Reconcile before retrying.",
      lastSyncedSnapshot: { email: "old@example.com" },
    }),
  });
  await enqueue(h);
  assert.equal(statusOf(h), "needs_reconciliation");
  assert.equal(h.syncState?.desiredVersion, 5);
  assert.equal(h.syncState?.creationAttemptId, "attempt-1");
  assert.equal(h.syncState?.creationAttemptVersion, 3);
  assert.equal(h.syncState?.creationAttemptStatus, "unknown");
  assert.equal(h.syncState?.creationAttemptedAt?.getTime(), attemptedAt.getTime());
  assert.equal(h.syncState?.lastErrorCode, "creation_outcome_unknown");
  assert.equal(h.syncState?.lastError, "Reconcile before retrying.");
  assert.deepEqual(h.syncState?.lastSyncedSnapshot, { email: "old@example.com" });
});

test("historical customer initialization does not infer verification from legacy synced status", async () => {
  const h = makeHarness({
    client: { ghlSyncStatus: "synced", ghlContactId: "legacy-contact" },
  });
  await enqueue(h);
  assert.equal(statusOf(h), "pending");
  assert.equal(h.syncState?.contactVerificationStatus, "unverified");
  assert.equal(h.syncState?.verifiedGhlLocationId, null);
});

test("historical valid or malformed creation claims require reconciliation", async () => {
  const claims: unknown[] = [
    { version: 1, status: "creating", sessionId: 2, batchId: 9, attemptedAt: "2026-11-01T00:00:00Z" },
    { version: 1, status: "unknown", sessionId: 2, batchId: 9 },
    { version: 2, status: "creating" },
    "malformed",
    [],
  ];

  for (const claim of claims) {
    const h = makeHarness({ client: { ghlContactCreationState: claim } });
    await enqueue(h);
    assert.equal(statusOf(h), "needs_reconciliation");
    assert.equal(h.client.ghlContactCreationState, claim);
  }
});

test("missing customer cannot produce an orphan sync-state row", async () => {
  const h = makeHarness({ clientExists: false });
  await assert.rejects(enqueue(h), CustomerSyncOutboxError);
  assert.equal(h.syncState, null);
  assert.equal(h.createCount, 0);
});

test("transaction rollback leaves no durable enqueue", async () => {
  const h = makeHarness();
  await assert.rejects(
    h.transaction(async (tx) => {
      await enqueueCustomerSync(tx as never, {
        golfClientId: 7,
        reason: "created",
      });
      throw new Error("rollback");
    }),
    /rollback/,
  );
  assert.equal(h.syncState, null);
  assert.equal(h.createCount, 1);
});

test("concurrent initialization and increments serialize on GolfClient", async () => {
  const h = makeHarness();
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      enqueue(h, index === 0 ? "created" : "profile_changed"),
    ),
  );

  assert.equal(h.createCount, 1);
  assert.equal(h.syncState?.desiredVersion, 12);
  assert.equal(new Set(results.map((result) => result.desiredVersion)).size, 12);
  assert.ok(h.lockSql.every((sql) => sql.includes("FROM GolfClient") && sql.includes("FOR UPDATE")));
});
