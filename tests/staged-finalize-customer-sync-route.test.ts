import assert from "node:assert/strict";
import { after, test } from "node:test";
import { NextRequest } from "next/server";
import { signStaffSessionToken } from "../lib/auth/session";

test("finalization reports a post-commit customer sync failure without losing the fitting", async () => {
  const secret = process.env.SESSION_SECRET;
  const flag = process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED;
  const prisma = Object.getOwnPropertyDescriptor(globalThis, "prisma");
  after(() => {
    if (secret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = secret;
    if (flag === undefined) delete process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED;
    else process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = flag;
    if (prisma) Object.defineProperty(globalThis, "prisma", prisma);
    else Reflect.deleteProperty(globalThis, "prisma");
  });
  process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-characters";
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  let attempts = 0;
  Object.defineProperty(globalThis, "prisma", {
    configurable: true, writable: true,
    value: {
      staffUser: { async findUnique() { return { name: "Staff" }; } },
      importBatch: {
        async findUnique() {
          return {
            demoSessionId: 7,
            opportunityResolution: "new",
            demoSession: { id: 7, status: "finalized", clientId: 3, ghlOpportunityId: null },
          };
        },
      },
      async $transaction() { attempts++; throw new Error("test database unavailable"); },
    },
  });
  const { POST } = await import("../app/api/staff/imports/[id]/finalize/route");
  const token = signStaffSessionToken({ staffUserId: 1, expiresAt: Date.now() + 60_000 });
  const request = (authenticated: boolean) => new NextRequest(
    "http://localhost/api/staff/imports/1/finalize",
    { method: "POST", headers: authenticated ? { cookie: `staff_session=${token}` } : {} },
  );
  assert.equal((await POST(request(false), { params: Promise.resolve({ id: "1" }) })).status, 401);
  assert.equal(attempts, 0);
  const response = await POST(request(true), { params: Promise.resolve({ id: "1" }) });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.demoSessionId, 7);
  assert.equal(body.customerSync, "needs_reconciliation");
  assert.equal(attempts, 1);
});
