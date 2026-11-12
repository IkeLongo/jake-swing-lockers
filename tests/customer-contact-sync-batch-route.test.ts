import assert from "node:assert/strict";
import { after, test } from "node:test";
import { NextRequest } from "next/server";
import { signStaffSessionToken } from "../lib/auth/session";

const originalSessionSecret = process.env.SESSION_SECRET;
const originalFlag = process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED;
process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-characters";

after(() => {
  if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSessionSecret;
  if (originalFlag === undefined) delete process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED;
  else process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = originalFlag;
});

test("manual endpoint enforces active admin authorization and validates options", async () => {
  let staff: { id: number; role: string; isActive: boolean } | null = null;
  let lookups = 0;
  let selections = 0;
  const originalPrisma = Object.getOwnPropertyDescriptor(globalThis, "prisma");
  Object.defineProperty(globalThis, "prisma", {
    configurable: true,
    writable: true,
    value: {
      staffUser: { async findUnique() { lookups++; return staff; } },
      async $queryRaw() { selections++; return []; },
    },
  });
  after(() => {
    if (originalPrisma) Object.defineProperty(globalThis, "prisma", originalPrisma);
    else Reflect.deleteProperty(globalThis, "prisma");
  });
  const { POST } = await import("../app/api/staff/admin/customer-contact-sync/route");
  const token = signStaffSessionToken({ staffUserId: 1, expiresAt: Date.now() + 60_000 });
  const request = (body: string, authenticated = true, contentType = "application/json") =>
    new NextRequest("http://localhost/api/staff/admin/customer-contact-sync", {
      method: "POST",
      headers: {
        "content-type": contentType,
        ...(authenticated ? { cookie: `staff_session=${token}` } : {}),
      },
      body,
    });

  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  assert.equal((await POST(request("{}", false))).status, 401);
  assert.equal(lookups, 0);
  assert.equal((await POST(request("{}"))).status, 403);

  staff = { id: 1, role: "staff", isActive: true };
  assert.equal((await POST(request("{}"))).status, 403);
  staff = { id: 1, role: "admin", isActive: false };
  assert.equal((await POST(request("{}"))).status, 403);
  staff = { id: 1, role: "admin", isActive: true };
  delete process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED;
  assert.equal((await POST(request("{}"))).status, 409);

  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  assert.equal((await POST(request("{}", true, "text/plain"))).status, 415);
  for (const body of ["{", "null", "[]", '{"limit":0}', '{"limit":11}', '{"limit":"5"}', '{"golfClientId":1}']) {
    assert.equal((await POST(request(body))).status, 400, body);
  }
  assert.equal(selections, 0);
  const response = await POST(request('{"limit":2}'));
  assert.equal(response.status, 200);
  assert.equal(selections, 1);
  assert.deepEqual(await response.json(), {
    status: "completed",
    summary: {
      processed: 0, succeeded: 0, retryScheduled: 0, needsReview: 0,
      needsReconciliation: 0, skipped: 0, errors: 0,
    },
  });
});
