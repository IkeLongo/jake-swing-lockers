import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { after, test } from "node:test";
import { NextRequest } from "next/server";
import { RequestCookiesAdapter } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import { signStaffSessionToken } from "../lib/auth/session";

const nextHeaders: typeof import("next/headers") =
  createRequire(resolve("tests", "legacy-demo-authorization.test.ts"))("next/headers");
const originalSecret = process.env.SESSION_SECRET;
process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-characters";

after(() => {
  if (originalSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSecret;
});

test("legacy demo action rejects unauthenticated and inactive staff before writes", async (t) => {
  let token: string | null = null;
  let active: boolean | null = null;
  let databaseUnavailable = false;
  let staffReads = 0;
  let writes = 0;
  let networkCalls = 0;
  let customerSyncReads = 0;
  const tx = {
    async $queryRaw() { return [{ id: 7 }]; },
    golfClient: {
      async findMany() { return []; },
      async findUnique(args: { select: { ghlContactCreationState?: boolean; firstName?: boolean } }) {
        if (args.select.firstName) customerSyncReads++;
        return args.select.ghlContactCreationState
          ? { ghlContactCreationState: null }
          : null;
      },
      async create() { writes++; return { id: 7 }; },
    },
    golfClientSyncState: {
      async findUnique() { return null; },
      async create() {
        writes++;
        return { desiredVersion: 1, workStatus: "pending" };
      },
    },
  };
  const fakeDb = {
    ...tx,
    staffUser: {
      async findUnique(args: { where: { id: number } }) {
        staffReads++;
        assert.equal(args.where.id, 1);
        if (databaseUnavailable) throw new Error("Staff lookup unavailable");
        return active === null ? null : { isActive: active };
      },
    },
    async $transaction<T>(fn: (transaction: typeof tx) => Promise<T>): Promise<T> {
      return fn(tx);
    },
    demoSession: {
      async create() { writes++; return { id: 9 }; },
      async findUnique() { return null; },
    },
    demoClubTest: {
      async create() { writes++; return { id: 11 }; },
    },
  };
  const originalPrisma = Object.getOwnPropertyDescriptor(globalThis, "prisma");
  Object.defineProperty(globalThis, "prisma", {
    configurable: true,
    writable: true,
    value: fakeDb,
  });
  t.after(() => {
    if (originalPrisma) Object.defineProperty(globalThis, "prisma", originalPrisma);
    else Reflect.deleteProperty(globalThis, "prisma");
  });
  t.mock.method(nextHeaders, "cookies", async () => {
    const request = new NextRequest("http://localhost", {
      headers: token ? { cookie: `staff_session=${token}` } : {},
    });
    return RequestCookiesAdapter.seal(request.cookies);
  });
  t.mock.method(globalThis, "fetch", async () => {
    networkCalls++;
    throw new Error("GHL must not be called by this test");
  });

  const { createDemoSession } = await import("../app/actions/demo");
  const input = {
    firstName: "Test",
    lastName: "Customer",
    email: "test@example.com",
    salesRep: "Staff",
    demoDate: "2026-11-11",
    demoClubs: [{
      demo: {
        clubType: "Driver", brand: "Test", model: "Test", shaft: "Test",
        loft: "10", estimatedPrice: 100,
      },
      current: {},
    }],
  };
  const signedToken = (staffUserId: number, expiresAt = Date.now() + 60_000) =>
    signStaffSessionToken({ staffUserId, expiresAt });

  for (const invalidToken of [
    null,
    "invalid",
    `${signedToken(1)}x`,
    signedToken(1, Date.now() - 60_000),
    signedToken(0),
  ]) {
    token = invalidToken;
    assert.deepEqual(await createDemoSession(input), {
      success: false, message: "Unauthorized.",
    });
  }
  assert.equal(staffReads, 0);

  token = signedToken(1);
  for (const staffState of [null, false]) {
    active = staffState;
    assert.deepEqual(await createDemoSession(input), {
      success: false, message: "Unauthorized.",
    });
  }
  assert.equal(staffReads, 2);
  assert.equal(writes, 0);
  assert.equal(networkCalls, 0);

  databaseUnavailable = true;
  await assert.rejects(createDemoSession(input), /Staff lookup unavailable/);
  assert.equal(writes, 0);
  assert.equal(networkCalls, 0);
  databaseUnavailable = false;
  active = true;
  const authorized = await createDemoSession(input);
  assert.equal(authorized.success, true);
  if (authorized.success) assert.equal(authorized.demoSessionId, 9);
  assert.equal(writes, 4);
  assert.equal(networkCalls, 0);
  assert.equal(customerSyncReads, 0);
});
