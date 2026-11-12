import assert from "node:assert/strict";
import { after, test } from "node:test";
import { NextRequest } from "next/server";
import { Prisma } from "../app/generated/prisma/client";
import { signStaffSessionToken } from "../lib/auth/session";
import { computeApprovalSignature, resolveBatchLocalIdentity, type GhlReviewSnapshot } from "../lib/imports/ghl-contact-approval";

test("legacy and staged entry points keep uncertain claims and release safe outcomes", async () => {
  const originalPrisma = Object.getOwnPropertyDescriptor(globalThis, "prisma");
  const originalFetch = globalThis.fetch;
  const keys = [
    "SESSION_SECRET", "GHL_SWINGLOCKER_LOCATION_ID", "GHL_SWINGLOCKER_PRIVATE_TOKEN",
    "GHL_SWINGLOCKER_PIPELINE_ID", "GHL_SWINGLOCKER_STAGE_DEMO_SUBMITTED_ID",
    "GHL_CUSTOMER_CONTACT_SYNC_ENABLED",
  ] as const;
  const env = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    SESSION_SECRET: "test-only-session-secret-at-least-32-characters",
    GHL_SWINGLOCKER_LOCATION_ID: "location",
    GHL_SWINGLOCKER_PRIVATE_TOKEN: "test-token",
    GHL_SWINGLOCKER_PIPELINE_ID: "pipeline",
    GHL_SWINGLOCKER_STAGE_DEMO_SUBMITTED_ID: "stage",
    GHL_CUSTOMER_CONTACT_SYNC_ENABLED: "false",
  });
  after(() => {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
    if (originalPrisma) Object.defineProperty(globalThis, "prisma", originalPrisma);
    else Reflect.deleteProperty(globalThis, "prisma");
  });

  const client = {
    id: 3, firstName: "Ann", lastName: "Lee", email: "ann@example.test", phone: null,
    ghlContactId: "contact", ghlContactCreationState: null, syncState: null,
  };
  const session = {
    id: 7, clientId: 3, status: "finalized", lockerToken: "token", demoDate: new Date(),
    salesRep: null, currentClub: null, ghlOpportunityId: null as string | null,
    ghlSyncStatus: null as string | null, ghlSyncError: null as string | null,
    ghlSyncState: null as unknown, ghlLockerReadyTagAddedAt: null as Date | null,
    clubTests: [], client,
  };
  const snapshot: GhlReviewSnapshot = {
    v: 1, discoverySignature: "a".repeat(64), incomplete: false,
    candidates: [], acknowledgedDiscrepancies: [], acknowledgedCandidateIds: [],
  };
  const batch = {
    id: 1, parserMode: "trackman-result", status: "finalized", demoSessionId: 7,
    customerResolution: "existing", selectedGolfClientId: 3,
    proposedFirstName: null, proposedLastName: null, proposedEmail: null, proposedPhone: null,
    opportunityResolution: "existing", selectedGhlOpportunityId: "opp",
    ghlContactDecision: "existing" as const, approvedGhlContactId: "contact",
    ghlContactApprovalSignature: "", ghlContactReviewSnapshot: snapshot,
    demoSession: session,
  };
  batch.ghlContactApprovalSignature = computeApprovalSignature({
    identity: resolveBatchLocalIdentity(batch, client)!, decision: "existing",
    approvedContactId: "contact", snapshot,
  });
  let failLegacyLoad = false;
  let failStagedLoad = false;
  let siblingState: unknown = null;
  let workerState: null | {
    workStatus: string; desiredVersion: number; syncedVersion: number;
    claimedVersion: null; claimToken: null; leaseExpiresAt: null;
    creationAttemptId: null; creationAttemptVersion: null;
    creationAttemptStatus: null; creationAttemptedAt: null;
    retryDue: null; leaseValid: null;
  } = null;
  const fake = {
    async $transaction<T>(fn: (tx: object) => Promise<T>): Promise<T> { return fn(this); },
    async $queryRaw(strings: TemplateStringsArray) {
      if (strings.join("?").includes("FROM GolfClientSyncState")) return workerState ? [workerState] : [];
      if (strings.join("?").includes("SELECT id, ghlSyncState")) {
        return [
          { id: 7, ghlSyncState: structuredClone(session.ghlSyncState) },
          { id: 8, ghlSyncState: structuredClone(siblingState) },
        ];
      }
      return [{ id: 7 }];
    },
    demoSession: {
      async findUniqueOrThrow() { return { ghlSyncState: structuredClone(session.ghlSyncState) }; },
      async findUnique(args: { select?: { clientId?: boolean } }) {
        if (args.select?.clientId) return { clientId: 3 };
        if (failLegacyLoad) throw new Error("local read failed");
        return session;
      },
      async update({ data }: { data: Record<string, unknown> }) {
        Object.assign(session, data);
        if (data.ghlSyncState === Prisma.DbNull) session.ghlSyncState = null;
      },
    },
    golfClient: {
      async findMany() { return []; },
      async findUnique(args: { select?: { firstName?: boolean } }) {
        return args.select?.firstName ? client : { id: 3 };
      },
      async findUniqueOrThrow() { return { ghlContactCreationState: client.ghlContactCreationState }; },
      async update() {},
    },
    importBatch: {
      async findUnique({ select }: { select: { parserMode?: boolean } }) {
        if (select.parserMode && failStagedLoad) throw new Error("local read failed");
        return select.parserMode ? batch : { demoSessionId: 7 };
      },
    },
    ghlSyncEvent: { async create() {} },
  };
  Object.defineProperty(globalThis, "prisma", { configurable: true, writable: true, value: fake });
  let mode: "success" | "opportunity-timeout" | "opportunity-rejected" | "tag-timeout" = "success";
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url.pathname}`);
    const contact = { id: "contact", locationId: "location", firstName: "Ann", lastName: "Lee", email: "ann@example.test" };
    if (url.pathname === "/contacts/lookup") return Response.json({ contacts: [contact] });
    if (url.pathname === "/contacts/contact" && method === "GET") return Response.json({ contact });
    if (url.pathname === "/contacts/contact" && method === "PUT") return Response.json({ contact });
    if (url.pathname === "/opportunities/opp" && method === "GET") {
      return Response.json({ opportunity: { id: "opp", contactId: "contact", locationId: "location", pipelineId: "pipeline", status: "open" } });
    }
    if (url.pathname === "/opportunities/" && method === "POST") {
      if (mode === "opportunity-timeout") throw new Error("response timed out");
      if (mode === "opportunity-rejected") return Response.json({ error: "rejected" }, { status: 400 });
      return Response.json({ opportunity: { id: "opp" } });
    }
    if (url.pathname === "/contacts/contact/tags" && method === "POST") {
      if (mode === "tag-timeout") throw new Error("response timed out");
      return Response.json({});
    }
    throw new Error(`Unexpected mocked request: ${method} ${url.pathname}`);
  };

  const { syncGolfDemoToGHL } = await import("../lib/ghl/syncGolfDemo");
  const { POST } = await import("../app/api/staff/imports/[id]/crm-sync/route");
  const token = signStaffSessionToken({ staffUserId: 1, expiresAt: Date.now() + 60_000 });
  const request = () => new NextRequest("http://localhost/api/staff/imports/1/crm-sync", {
    method: "POST", headers: { cookie: `staff_session=${token}` },
  });
  const runStaged = () => POST(request(), { params: Promise.resolve({ id: "1" }) });
  const reset = () => {
    session.ghlSyncState = null;
    session.ghlSyncStatus = null;
    session.ghlOpportunityId = null;
    session.ghlLockerReadyTagAddedAt = null;
    calls.length = 0;
  };

  for (const marker of [
    { fittingClaim: { token: "interrupted" } },
    { contact: { status: "creating" } },
    { opportunity: { status: "creating" } },
  ]) {
    reset();
    session.ghlSyncState = { version: 1, ...marker };
    assert.equal((await syncGolfDemoToGHL(7)).requiresReconciliation, true);
    const blocked = await runStaged();
    assert.equal(blocked.status, 409);
    const body = await blocked.json();
    assert.equal(body.status, "failed");
    assert.equal(body.code, "sync-needs-reconciliation");
    assert.equal(body.retryable, false);
    assert.match(body.error, /staff review/i);
    assert.equal(calls.length, 0);
  }

  reset();
  siblingState = { version: 1, fittingClaim: { token: "prior-uncertain-contact" } };
  assert.equal((await syncGolfDemoToGHL(7)).requiresReconciliation, true);
  assert.equal((await runStaged()).status, 409);
  assert.equal(calls.length, 0);
  siblingState = null;

  reset();
  Object.assign(client, { ghlContactCreationState: { status: "creating" } });
  assert.equal((await syncGolfDemoToGHL(7)).requiresReconciliation, true);
  assert.equal(calls.length, 0);
  Object.assign(client, { ghlContactCreationState: null });
  reset();
  session.ghlOpportunityId = "opp";
  Object.assign(client, { syncState: { desiredVersion: 1, creationAttemptStatus: "unknown" } });
  const customerBlocked = await runStaged();
  assert.equal((await customerBlocked.json()).code, "creation-needs-reconciliation");
  assert.equal(calls.length, 0);
  Object.assign(client, { syncState: null });

  reset();
  failLegacyLoad = true;
  assert.equal((await syncGolfDemoToGHL(7)).requiresReconciliation, undefined);
  assert.equal(session.ghlSyncState, null);
  failLegacyLoad = false;
  failStagedLoad = true;
  assert.equal((await runStaged()).status, 503);
  assert.equal(session.ghlSyncState, null);
  assert.equal(calls.length, 0);
  failStagedLoad = false;

  reset();
  Object.assign(client, { ghlContactId: null });
  const unlinked = await syncGolfDemoToGHL(7);
  assert.equal(unlinked.success, false);
  assert.match(unlinked.error!, /no saved GHL contact/i);
  assert.equal(session.ghlSyncState, null);
  assert.equal(calls.length, 0);
  Object.assign(client, { ghlContactId: "contact" });

  reset();
  client.email = "invalid";
  const invalid = await syncGolfDemoToGHL(7);
  assert.equal(invalid.success, false);
  assert.equal(invalid.requiresReconciliation, undefined);
  assert.equal(session.ghlSyncState, null);
  assert.equal(calls.length, 0);
  client.email = "ann@example.test";

  reset();
  delete process.env.GHL_SWINGLOCKER_PIPELINE_ID;
  const missingConfig = await syncGolfDemoToGHL(7);
  assert.equal(missingConfig.success, false);
  assert.equal(missingConfig.requiresReconciliation, undefined);
  assert.equal(session.ghlSyncState, null);
  assert.equal(calls.some((call) => call === "POST /opportunities/"), false);
  process.env.GHL_SWINGLOCKER_PIPELINE_ID = "pipeline";

  reset();
  mode = "opportunity-rejected";
  assert.equal((await syncGolfDemoToGHL(7)).requiresReconciliation, undefined);
  assert.equal(session.ghlSyncState, null);

  reset();
  mode = "opportunity-timeout";
  assert.equal((await syncGolfDemoToGHL(7)).requiresReconciliation, true);
  assert.ok(session.ghlSyncState);
  assert.equal((await syncGolfDemoToGHL(7)).requiresReconciliation, true);
  assert.equal(calls.filter((call) => call === "POST /opportunities/").length, 1);

  reset();
  mode = "success";
  assert.equal((await syncGolfDemoToGHL(7)).success, true);
  assert.equal(session.ghlSyncState, null);

  reset();
  session.ghlOpportunityId = "opp";
  mode = "tag-timeout";
  const timeout = await runStaged();
  const timeoutBody = await timeout.json();
  assert.equal(timeoutBody.code, "sync-needs-reconciliation");
  assert.equal(timeoutBody.retryable, false);
  assert.ok(session.ghlSyncState);
  assert.equal((await runStaged()).status, 409);
  assert.equal(calls.filter((call) => call === "POST /contacts/contact/tags").length, 1);

  reset();
  session.ghlOpportunityId = "opp";
  mode = "success";
  const success = await runStaged();
  assert.equal(success.status, 200);
  assert.equal((await success.json()).status, "synced");
  assert.equal(session.ghlSyncState, null);

  reset();
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  workerState = {
    workStatus: "synced", desiredVersion: 1, syncedVersion: 1,
    claimedVersion: null, claimToken: null, leaseExpiresAt: null,
    creationAttemptId: null, creationAttemptVersion: null,
    creationAttemptStatus: null, creationAttemptedAt: null,
    retryDue: null, leaseValid: null,
  };
  Object.assign(client, { syncState: workerState });
  assert.equal((await syncGolfDemoToGHL(7)).success, true);
  assert.equal(session.ghlSyncState, null);
});
