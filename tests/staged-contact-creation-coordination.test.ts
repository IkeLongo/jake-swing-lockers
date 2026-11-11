import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "../app/generated/prisma/client";
import {
  CreationNeedsReconciliationError,
} from "../lib/ghl/syncStagedFitting";
import { ContactNeedsReviewError } from "../lib/ghl/resolveStagedContact";
import { createPrismaStagedSyncDeps } from "../lib/ghl/syncStagedFittingStore";

interface FakeClient {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  ghlContactId: string | null;
  ghlContactCreationState: unknown;
}

interface FakeSession {
  id: number;
  clientId: number;
  ghlSyncState: unknown;
  ghlSyncStatus: string | null;
  ghlSyncError: string | null;
}

interface FakeSyncState {
  golfClientId: number;
  desiredVersion: number;
  syncedVersion: number;
  workStatus: string;
  claimToken: string | null;
  claimedVersion: number | null;
  leaseExpiresAt: Date | null;
  creationAttemptId: string | null;
  creationAttemptVersion: number | null;
  creationAttemptStatus: string | null;
  creationAttemptedAt: Date | null;
  nextAttemptAt: Date | null;
  lastErrorCode: string | null;
  lastError: string | null;
}

function fakeDatabase() {
  const client: FakeClient = {
    id: 3,
    firstName: "Ann",
    lastName: "Lee",
    email: "ann@example.com",
    phone: null,
    ghlContactId: null,
    ghlContactCreationState: null,
  };
  const sessions = new Map<number, FakeSession>([
    [7, { id: 7, clientId: client.id, ghlSyncState: null, ghlSyncStatus: null, ghlSyncError: null }],
    [8, { id: 8, clientId: client.id, ghlSyncState: null, ghlSyncStatus: null, ghlSyncError: null }],
  ]);
  let syncState: FakeSyncState = {
    golfClientId: client.id,
    desiredVersion: 1,
    syncedVersion: 0,
    workStatus: "pending",
    claimToken: null,
    claimedVersion: null,
    leaseExpiresAt: null,
    creationAttemptId: null,
    creationAttemptVersion: null,
    creationAttemptStatus: null,
    creationAttemptedAt: null,
    nextAttemptAt: null,
    lastErrorCode: null,
    lastError: null,
  };
  let syncStateExists = true;
  let failNextContactLinkWrite = false;
  const sql: string[] = [];
  let tail: Promise<void> = Promise.resolve();
  let transactionDepth = 0;

  const db = {
    async $transaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const clientSnapshot = { ...client };
      const syncStateSnapshot = { ...syncState };
      const syncStateExistsSnapshot = syncStateExists;
      const sessionSnapshot = new Map(
        [...sessions].map(([id, session]) => [id, { ...session }]),
      );
      transactionDepth++;
      try {
        return await fn(db as never);
      } catch (error) {
        Object.assign(client, clientSnapshot);
        syncState = syncStateSnapshot;
        syncStateExists = syncStateExistsSnapshot;
        sessions.clear();
        for (const [id, session] of sessionSnapshot) sessions.set(id, session);
        throw error;
      } finally {
        transactionDepth--;
        release();
      }
    },
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> {
      const query = strings.join("?");
      sql.push(query);
      if (query.includes("FROM GolfClient WHERE")) return [{ id: client.id }];
      if (query.includes("FROM GolfClientSyncState WHERE")) {
        return syncStateExists ? [{ golfClientId: syncState.golfClientId }] : [];
      }
      if (query.includes("FROM DemoSession WHERE")) {
        const session = sessions.get(Number(values[0]));
        return session ? [{ id: session.id }] : [];
      }
      return [];
    },
    golfClient: {
      async findUniqueOrThrow() {
        return { ...client };
      },
      async findUnique(args: { where: { ghlContactId?: string } }) {
        if (args.where.ghlContactId && args.where.ghlContactId !== client.ghlContactId) {
          return null;
        }
        return { id: client.id };
      },
      async update(args: {
        data: Partial<FakeClient> & { ghlContactCreationState?: unknown };
      }) {
        if (args.data.ghlContactId && failNextContactLinkWrite) {
          failNextContactLinkWrite = false;
          throw new Error("customer contact link write failed");
        }
        const state = args.data.ghlContactCreationState;
        Object.assign(client, args.data);
        if (state === Prisma.DbNull) client.ghlContactCreationState = null;
        return client;
      },
      async updateMany(args: {
        where: { id: number; OR: { ghlContactId: string | null }[] };
        data: { ghlContactId: string; ghlContactCreationState?: unknown };
      }) {
        if (
          args.where.id !== client.id ||
          !args.where.OR.some((condition) => condition.ghlContactId === client.ghlContactId)
        ) {
          return { count: 0 };
        }
        client.ghlContactId = args.data.ghlContactId;
        if (args.data.ghlContactCreationState === Prisma.DbNull) {
          client.ghlContactCreationState = null;
        }
        return { count: 1 };
      },
    },
    golfClientSyncState: {
      async findUniqueOrThrow() {
        if (!syncStateExists) throw new Error("sync state not found");
        return { ...syncState };
      },
      async create(args: { data: { golfClientId: number } }) {
        syncStateExists = true;
        syncState = { ...syncState, golfClientId: args.data.golfClientId };
        return { ...syncState };
      },
    },
    demoSession: {
      async findUniqueOrThrow(args: { where: { id: number } }) {
        const session = sessions.get(args.where.id);
        if (!session) throw new Error("session not found");
        return { ...session };
      },
      async update(args: {
        where: { id: number };
        data: Partial<FakeSession> & { ghlSyncState?: unknown };
      }) {
        const session = sessions.get(args.where.id);
        if (!session) throw new Error("session not found");
        Object.assign(session, args.data);
        if (args.data.ghlSyncState === Prisma.DbNull) session.ghlSyncState = null;
        return session;
      },
    },
    ghlSyncEvent: {
      async create() {
        return { id: 1 };
      },
    },
    async $executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const query = strings.join("?");
      sql.push(query);
      if (
        query.includes("SET creationAttemptId = ?") &&
        query.includes("creationAttemptStatus = 'started'")
      ) {
        const [id, version] = values;
        if (!syncStateExists || syncState.workStatus !== "pending" || syncState.desiredVersion !== version) return 0;
        syncState = {
          ...syncState,
          creationAttemptId: String(id),
          creationAttemptVersion: Number(version),
          creationAttemptStatus: "started",
          creationAttemptedAt: new Date(),
        };
        return 1;
      }
      if (query.includes("SET workStatus = ?")) {
        const [status, attemptId, attemptVersion, attemptStatus, clear, code, message] = values;
        const where = values.slice(-3);
        if (
          syncState.workStatus !== "pending" ||
          syncState.creationAttemptId !== where[1] ||
          syncState.creationAttemptVersion !== where[2] ||
          syncState.creationAttemptStatus !== "started"
        ) return 0;
        syncState = {
          ...syncState,
          workStatus: String(status),
          creationAttemptId: attemptId === null ? null : String(attemptId),
          creationAttemptVersion: attemptVersion === null ? null : Number(attemptVersion),
          creationAttemptStatus: attemptStatus === null ? null : String(attemptStatus),
          creationAttemptedAt: clear ? null : syncState.creationAttemptedAt,
          lastErrorCode: code === null ? null : String(code),
          lastError: message === null ? null : String(message),
        };
        return 1;
      }
      return 0;
    },
  };
  return {
    db,
    client,
    sessions,
    sql,
    get syncState() {
      return syncState;
    },
    get hasSyncState() {
      return syncStateExists;
    },
    setSyncDesiredVersion(version: number) {
      syncState.desiredVersion = version;
    },
    setSyncState(patch: Partial<FakeSyncState>) {
      syncStateExists = true;
      syncState = { ...syncState, ...patch };
    },
    removeSyncState() {
      syncStateExists = false;
    },
    failContactLinkWrite() {
      failNextContactLinkWrite = true;
    },
    get transactionActive() {
      return transactionDepth > 0;
    },
  };
}

function installFakeGhlApi(opts: {
  loseCreateResponse?: boolean;
  delayCreate?: boolean;
  createStatus?: number;
  duplicateOnCreate?: boolean;
  failContactRead?: boolean;
  coordinatorEnabled?: boolean;
  customerSyncEnabled?: boolean;
  omitCoordinatorFlag?: boolean;
} = {}) {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.GHL_SWINGLOCKER_PRIVATE_TOKEN;
  const originalLocationId = process.env.GHL_SWINGLOCKER_LOCATION_ID;
  const originalCoordinatorFlag = process.env.GHL_STAGED_CONTACT_COORDINATOR_ENABLED;
  const originalCustomerSyncFlag = process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED;
  const contacts = new Map<string, Record<string, unknown>>();
  let creates = 0;
  let onCreate: () => void = () => {};
  let onContactRead: () => void = () => {};
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/contacts/lookup") {
      const email = url.searchParams.get("email");
      const phone = url.searchParams.get("phone");
      const matches = [...contacts.values()].filter(
        (contact) =>
          (email !== null && contact.email === email) ||
          (phone !== null && contact.phone === phone),
      );
      return Response.json({ contacts: matches });
    }
    if (url.pathname === "/contacts" && init?.method === "POST") {
      creates++;
      onCreate();
      if (opts.duplicateOnCreate) {
        return Response.json({
          message: "This location does not allow duplicated contacts",
          meta: { contactId: "existing-contact" },
        }, { status: 400 });
      }
      if (opts.createStatus) {
        return Response.json({ message: "creation rejected" }, { status: opts.createStatus });
      }
      const inputBody = JSON.parse(String(init.body)) as Record<string, unknown>;
      const id = "contact-created";
      contacts.set(id, {
        id,
        locationId: "loc-test",
        firstName: inputBody.firstName,
        lastName: inputBody.lastName,
        email: inputBody.email,
        phone: inputBody.phone,
      });
      if (opts.delayCreate) await new Promise((resolve) => setTimeout(resolve, 20));
      if (opts.loseCreateResponse) throw new Error("socket closed after remote create");
      return Response.json({ contact: { id } });
    }
    const id = decodeURIComponent(url.pathname.slice("/contacts/".length));
    onContactRead();
    if (opts.failContactRead) {
      return Response.json({ message: "lookup unavailable" }, { status: 500 });
    }
    const contact = contacts.get(id);
    if (contact) return Response.json({ contact });
    return Response.json({ message: "not found" }, { status: 404 });
  };
  process.env.GHL_SWINGLOCKER_PRIVATE_TOKEN = "test-token";
  process.env.GHL_SWINGLOCKER_LOCATION_ID = "loc-test";
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = opts.customerSyncEnabled
    ? "true"
    : "false";
  if (opts.omitCoordinatorFlag) {
    delete process.env.GHL_STAGED_CONTACT_COORDINATOR_ENABLED;
  } else {
    process.env.GHL_STAGED_CONTACT_COORDINATOR_ENABLED = opts.coordinatorEnabled ? "true" : "false";
  }
  return {
    contacts,
    get creates() {
      return creates;
    },
    restore() {
      globalThis.fetch = originalFetch;
      if (originalToken === undefined) delete process.env.GHL_SWINGLOCKER_PRIVATE_TOKEN;
      else process.env.GHL_SWINGLOCKER_PRIVATE_TOKEN = originalToken;
      if (originalLocationId === undefined) delete process.env.GHL_SWINGLOCKER_LOCATION_ID;
      else process.env.GHL_SWINGLOCKER_LOCATION_ID = originalLocationId;
      if (originalCoordinatorFlag === undefined) delete process.env.GHL_STAGED_CONTACT_COORDINATOR_ENABLED;
      else process.env.GHL_STAGED_CONTACT_COORDINATOR_ENABLED = originalCoordinatorFlag;
      if (originalCustomerSyncFlag === undefined) delete process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED;
      else process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = originalCustomerSyncFlag;
    },
    observeCreate(callback: () => void) {
      onCreate = callback;
    },
    observeContactRead(callback: () => void) {
      onContactRead = callback;
    },
    seedContact(id: string, values: Record<string, unknown> = {}) {
      contacts.set(id, {
        id,
        locationId: "loc-test",
        firstName: "Ann",
        lastName: "Lee",
        email: "ann@example.com",
        phone: null,
        ...values,
      });
    },
    loseCreateResponse(value: boolean) {
      opts.loseCreateResponse = value;
    },
  };
}

const contactInput = {
  firstName: "Ann",
  lastName: "Lee",
  email: "ann@example.com",
  phone: null,
};

function resolveArgs(sessionId: number) {
  return {
    sessionId,
    batchId: sessionId,
    clientId: 3,
    savedGhlContactId: null,
    expectedVersion: 1,
  };
}

test("different sessions for one customer cannot concurrently create two GHL contacts", async () => {
  const fake = fakeDatabase();
  const ghl = installFakeGhlApi({ delayCreate: true });
  const createSnapshot: {
    current: {
      transactionActive: boolean;
      customerClaim: unknown;
      sessionMarkers: unknown[];
    } | null;
  } = { current: null };
  let signalCreateStarted!: () => void;
  const createStarted = new Promise<void>((resolve) => {
    signalCreateStarted = resolve;
  });
  ghl.observeCreate(() => {
    createSnapshot.current = {
      transactionActive: fake.transactionActive,
      customerClaim: fake.client.ghlContactCreationState,
      sessionMarkers: [...fake.sessions.values()].map((session) => session.ghlSyncState),
    };
    signalCreateStarted();
  });
  try {
    const deps = createPrismaStagedSyncDeps(fake.db as never);
    const first = deps.resolveNewContact(contactInput, resolveArgs(7));
    await createStarted;
    const second = deps.resolveNewContact(contactInput, resolveArgs(8));
    const results = await Promise.allSettled([
      first,
      second,
    ]);

    const snapshot = createSnapshot.current;
    assert.ok(snapshot);
    assert.equal(snapshot.transactionActive, false);
    assert.ok(snapshot.customerClaim);
    assert.ok(snapshot.sessionMarkers.some(Boolean));
    assert.equal(ghl.creates, 1);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const blocked = results.find((result) => result.status === "rejected");
    assert.ok(blocked?.status === "rejected");
    assert.ok(blocked.reason instanceof CreationNeedsReconciliationError);
    assert.equal(fake.client.ghlContactId, "contact-created");
    assert.equal(fake.client.ghlContactCreationState, null);
    assert.ok(fake.sql.some((query) => query.includes("GolfClient") && query.includes("FOR UPDATE")));
  } finally {
    ghl.restore();
  }
});

test("ambiguous contact creation blocks other sessions and safely recovers the original session", async () => {
  const fake = fakeDatabase();
  const ghl = installFakeGhlApi({ loseCreateResponse: true });
  const createSnapshot: {
    current: {
      transactionActive: boolean;
      customerClaim: unknown;
      sessionMarker: unknown;
    } | null;
  } = { current: null };
  ghl.observeCreate(() => {
    createSnapshot.current = {
      transactionActive: fake.transactionActive,
      customerClaim: fake.client.ghlContactCreationState,
      sessionMarker: fake.sessions.get(7)?.ghlSyncState,
    };
  });
  try {
    const deps = createPrismaStagedSyncDeps(fake.db as never);
    await assert.rejects(
      deps.resolveNewContact(contactInput, resolveArgs(7)),
      CreationNeedsReconciliationError,
    );
    const snapshot = createSnapshot.current;
    assert.ok(snapshot);
    assert.equal(snapshot.transactionActive, false);
    assert.ok(snapshot.customerClaim);
    assert.ok(snapshot.sessionMarker);
    assert.equal(ghl.creates, 1);
    assert.ok(fake.client.ghlContactCreationState);
    assert.ok(fake.sessions.get(7)?.ghlSyncState);

    ghl.loseCreateResponse(false);
    await assert.rejects(
      deps.resolveNewContact(contactInput, resolveArgs(8)),
      CreationNeedsReconciliationError,
    );
    assert.equal(ghl.creates, 1);

    const recovered = await deps.resolveNewContact(contactInput, resolveArgs(7));
    assert.deepEqual(recovered, { id: "contact-created" });
    assert.equal(ghl.creates, 1);
    assert.equal(fake.client.ghlContactId, "contact-created");
    assert.equal(fake.client.ghlContactCreationState, null);
  } finally {
    ghl.restore();
  }
});

test("missing coordinator flag keeps staged creation on the v1 claim path", async () => {
  const fake = fakeDatabase();
  const ghl = installFakeGhlApi({ omitCoordinatorFlag: true });
  let markerAtPost: unknown;
  ghl.observeCreate(() => {
    markerAtPost = fake.client.ghlContactCreationState;
  });
  try {
    const deps = createPrismaStagedSyncDeps(fake.db as never);
    assert.deepEqual(await deps.resolveNewContact(contactInput, resolveArgs(7)), {
      id: "contact-created",
    });
    assert.equal((markerAtPost as { version: number }).version, 1);
    assert.equal(fake.syncState.creationAttemptId, null);
    assert.equal(fake.sessions.get(7)?.ghlSyncState && (fake.sessions.get(7)?.ghlSyncState as {
      contact: { status: string };
    }).contact.status, "resolved");
  } finally {
    ghl.restore();
  }
});

test("enabled coordinator reserves and atomically resolves customer and session around the GHL POST", async () => {
  const fake = fakeDatabase();
  const ghl = installFakeGhlApi({ coordinatorEnabled: true });
  const postSnapshot: {
    current: {
      transactionActive: boolean;
      customerMarker: unknown;
      sessionMarker: unknown;
    } | null;
  } = { current: null };
  ghl.observeCreate(() => {
    postSnapshot.current = {
        transactionActive: fake.transactionActive,
        customerMarker: fake.client.ghlContactCreationState,
        sessionMarker: fake.sessions.get(7)?.ghlSyncState,
      };
  });
  try {
    const deps = createPrismaStagedSyncDeps(fake.db as never);
    assert.deepEqual(await deps.resolveNewContact(contactInput, resolveArgs(7)), {
      id: "contact-created",
    });
    const snapshot = postSnapshot.current;
    assert.ok(snapshot);
    assert.equal(snapshot.transactionActive, false);
    assert.equal((snapshot.customerMarker as { version: number }).version, 2);
    assert.ok(snapshot.sessionMarker);
    assert.equal(fake.client.ghlContactId, "contact-created");
    assert.equal(fake.client.ghlContactCreationState, null);
    assert.equal(fake.syncState.creationAttemptId, null);
    assert.equal(fake.syncState.syncedVersion, 0);
    assert.equal(fake.syncState.workStatus, "pending");
    assert.equal((fake.sessions.get(7)?.ghlSyncState as {
      contact: { status: string; attemptId: string };
    }).contact.status, "resolved");
    assert.ok((fake.sessions.get(7)?.ghlSyncState as {
      contact: { attemptId: string };
    }).contact.attemptId);
  } finally {
    ghl.restore();
  }
});

test("customer sync flag also coordinates staff-approved staged contact creation", async () => {
  const fake = fakeDatabase();
  const ghl = installFakeGhlApi({
    coordinatorEnabled: false,
    customerSyncEnabled: true,
  });
  try {
    const deps = createPrismaStagedSyncDeps(fake.db as never);
    assert.deepEqual(
      await deps.resolveNewContact(contactInput, resolveArgs(7)),
      { id: "contact-created" },
    );
    assert.equal(fake.client.ghlContactId, "contact-created");
    assert.equal(fake.syncState.workStatus, "pending");
    assert.ok(fake.syncState.creationAttemptId === null);
  } finally {
    ghl.restore();
  }
});

test("enabled coordinator initializes an absent sync row but rejects a stale expected version", async () => {
  const fake = fakeDatabase();
  fake.removeSyncState();
  const ghl = installFakeGhlApi({ coordinatorEnabled: true });
  try {
    const deps = createPrismaStagedSyncDeps(fake.db as never);
    assert.deepEqual(
      await deps.resolveNewContact(contactInput, { ...resolveArgs(7), expectedVersion: null }),
      { id: "contact-created" },
    );
    assert.equal(fake.syncState.creationAttemptId, null);
    assert.equal(fake.hasSyncState, true);
  } finally {
    ghl.restore();
  }

  const staleFake = fakeDatabase();
  const staleGhl = installFakeGhlApi({ coordinatorEnabled: true });
  try {
    const deps = createPrismaStagedSyncDeps(staleFake.db as never);
    await assert.rejects(
      deps.resolveNewContact(contactInput, { ...resolveArgs(7), expectedVersion: 2 }),
      CreationNeedsReconciliationError,
    );
    assert.equal(staleGhl.creates, 0);
    assert.equal(staleFake.syncState.creationAttemptId, null);
  } finally {
    staleGhl.restore();
  }
});

test("enabled coordinator recovers legacy v1 attempts without creating another contact", async () => {
  const fake = fakeDatabase();
  const ghl = installFakeGhlApi({ coordinatorEnabled: true });
  const attemptedAt = new Date().toISOString();
  fake.client.ghlContactCreationState = {
    version: 1,
    status: "creating",
    sessionId: 7,
    batchId: 7,
    attemptedAt,
  };
  fake.sessions.get(7)!.ghlSyncState = {
    version: 1,
    contact: { status: "creating", batchId: 7, clientId: 3, attemptedAt },
  };
  ghl.seedContact("legacy-contact");
  try {
    const deps = createPrismaStagedSyncDeps(fake.db as never);
    assert.deepEqual(await deps.resolveNewContact(contactInput, resolveArgs(7)), {
      id: "legacy-contact",
    });
    assert.equal(ghl.creates, 0);
    assert.equal(fake.client.ghlContactId, "legacy-contact");
    assert.equal(fake.client.ghlContactCreationState, null);
    assert.equal(fake.syncState.creationAttemptId, null);
  } finally {
    ghl.restore();
  }
});

test("enabled coordinator does not create when a verified customer contact is already linked", async () => {
  const fake = fakeDatabase();
  fake.client.ghlContactId = "already-linked";
  const ghl = installFakeGhlApi({ coordinatorEnabled: true });
  ghl.seedContact("already-linked");
  try {
    const deps = createPrismaStagedSyncDeps(fake.db as never);
    await assert.rejects(
      deps.resolveNewContact(contactInput, resolveArgs(7)),
      ContactNeedsReviewError,
    );
    assert.equal(ghl.creates, 0);
    assert.equal(fake.client.ghlContactId, "already-linked");
  } finally {
    ghl.restore();
  }
});

test("enabled coordinator blocks worker and unresolved coordinator attempts", async () => {
  const workerFake = fakeDatabase();
  workerFake.setSyncState({
    workStatus: "processing",
    claimToken: "worker-token",
    claimedVersion: 1,
    leaseExpiresAt: new Date(Date.now() + 60_000),
  });
  const workerGhl = installFakeGhlApi({ coordinatorEnabled: true });
  try {
    const deps = createPrismaStagedSyncDeps(workerFake.db as never);
    await assert.rejects(
      deps.resolveNewContact(contactInput, resolveArgs(7)),
      CreationNeedsReconciliationError,
    );
    assert.equal(workerGhl.creates, 0);
  } finally {
    workerGhl.restore();
  }

  const unresolvedFake = fakeDatabase();
  const attemptId = "unresolved-attempt";
  unresolvedFake.client.ghlContactCreationState = {
    version: 2,
    status: "creating",
    attemptId,
    attemptVersion: 1,
    owner: { kind: "staged", sessionId: 7, batchId: 7 },
  };
  unresolvedFake.setSyncState({
    creationAttemptId: attemptId,
    creationAttemptVersion: 1,
    creationAttemptStatus: "unknown",
  });
  const unresolvedGhl = installFakeGhlApi({ coordinatorEnabled: true });
  try {
    const deps = createPrismaStagedSyncDeps(unresolvedFake.db as never);
    await assert.rejects(
      deps.resolveNewContact(contactInput, resolveArgs(7)),
      CreationNeedsReconciliationError,
    );
    assert.equal(unresolvedGhl.creates, 0);
    assert.equal(unresolvedFake.client.ghlContactCreationState && (
      unresolvedFake.client.ghlContactCreationState as { attemptId: string }
    ).attemptId, attemptId);
  } finally {
    unresolvedGhl.restore();
  }
});

test("stale coordinator token cannot link a contact or clear the newer attempt", async () => {
  const fake = fakeDatabase();
  const ghl = installFakeGhlApi({ coordinatorEnabled: true });
  const newerAttemptId = "newer-attempt";
  ghl.observeContactRead(() => {
    fake.client.ghlContactCreationState = {
      version: 2,
      status: "creating",
      attemptId: newerAttemptId,
      attemptVersion: 1,
      owner: { kind: "staged", sessionId: 7, batchId: 7 },
    };
    fake.setSyncState({
      creationAttemptId: newerAttemptId,
      creationAttemptVersion: 1,
      creationAttemptStatus: "started",
    });
    fake.sessions.get(7)!.ghlSyncState = {
      version: 1,
      contact: {
        status: "creating",
        batchId: 7,
        clientId: 3,
        attemptId: newerAttemptId,
        attemptedAt: new Date().toISOString(),
      },
    };
  });
  try {
    const deps = createPrismaStagedSyncDeps(fake.db as never);
    await assert.rejects(
      deps.resolveNewContact(contactInput, resolveArgs(7)),
      CreationNeedsReconciliationError,
    );
    assert.equal(ghl.creates, 1);
    assert.equal(fake.client.ghlContactId, null);
    assert.equal(fake.syncState.creationAttemptId, newerAttemptId);
    assert.equal((fake.client.ghlContactCreationState as { attemptId: string }).attemptId, newerAttemptId);
  } finally {
    ghl.restore();
  }
});

test("enabled coordinator leaves uncertain POSTs fenced and never retries them", async () => {
  const fake = fakeDatabase();
  const ghl = installFakeGhlApi({ coordinatorEnabled: true, loseCreateResponse: true });
  try {
    const deps = createPrismaStagedSyncDeps(fake.db as never);
    await assert.rejects(
      deps.resolveNewContact(contactInput, resolveArgs(7)),
      CreationNeedsReconciliationError,
    );
    assert.equal(fake.syncState.workStatus, "needs_reconciliation");
    assert.equal(fake.syncState.creationAttemptStatus, "unknown");
    assert.ok(fake.client.ghlContactCreationState);
    assert.ok((fake.sessions.get(7)?.ghlSyncState as { contact: unknown }).contact);

    await assert.rejects(
      deps.resolveNewContact(contactInput, resolveArgs(7)),
      CreationNeedsReconciliationError,
    );
    assert.equal(ghl.creates, 1);
  } finally {
    ghl.restore();
  }
});

test("definitive duplicate rejection clears only the owned staged attempt for review", async () => {
  const fake = fakeDatabase();
  const ghl = installFakeGhlApi({ coordinatorEnabled: true, duplicateOnCreate: true });
  try {
    const deps = createPrismaStagedSyncDeps(fake.db as never);
    await assert.rejects(
      deps.resolveNewContact(contactInput, resolveArgs(7)),
      ContactNeedsReviewError,
    );
    assert.equal(ghl.creates, 1);
    assert.equal(fake.syncState.workStatus, "needs_review");
    assert.equal(fake.syncState.creationAttemptId, null);
    assert.equal(fake.client.ghlContactCreationState, null);
    assert.equal(fake.sessions.get(7)?.ghlSyncState, null);
  } finally {
    ghl.restore();
  }
});

test("failed local acknowledgement becomes uncertain without clearing creation markers", async () => {
  const fake = fakeDatabase();
  const ghl = installFakeGhlApi({ coordinatorEnabled: true });
  fake.failContactLinkWrite();
  try {
    const deps = createPrismaStagedSyncDeps(fake.db as never);
    await assert.rejects(
      deps.resolveNewContact(contactInput, resolveArgs(7)),
      CreationNeedsReconciliationError,
    );
    assert.equal(fake.client.ghlContactId, null);
    assert.ok(fake.client.ghlContactCreationState);
    assert.equal(fake.syncState.workStatus, "needs_reconciliation");
    assert.equal(fake.syncState.creationAttemptStatus, "unknown");
    assert.equal((fake.sessions.get(7)?.ghlSyncState as {
      contact: { status: string };
    }).contact.status, "creating");
    assert.equal(ghl.creates, 1);
  } finally {
    ghl.restore();
  }
});

test("profile edits during a staged create retain the newer profile and desired sync version", async () => {
  const fake = fakeDatabase();
  const ghl = installFakeGhlApi({ coordinatorEnabled: true });
  ghl.observeCreate(() => {
    fake.client.email = "new-ann@example.com";
    fake.setSyncDesiredVersion(2);
  });
  try {
    const deps = createPrismaStagedSyncDeps(fake.db as never);
    assert.deepEqual(await deps.resolveNewContact(contactInput, resolveArgs(7)), {
      id: "contact-created",
    });
    assert.equal(fake.client.email, "new-ann@example.com");
    assert.equal(fake.syncState.desiredVersion, 2);
    assert.equal(fake.syncState.syncedVersion, 0);
    assert.equal(fake.syncState.workStatus, "pending");
  } finally {
    ghl.restore();
  }
});
