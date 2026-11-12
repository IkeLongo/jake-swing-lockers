import assert from "node:assert/strict";
import { after, test } from "node:test";
import { NextRequest } from "next/server";
import { signStaffSessionToken } from "../lib/auth/session";

test("recovery requires an authenticated active staff account before work", async () => {
  const originalSecret = process.env.SESSION_SECRET;
  const originalPrisma = Object.getOwnPropertyDescriptor(globalThis, "prisma");
  process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-characters";
  let active = false;
  let work = 0;
  Object.defineProperty(globalThis, "prisma", {
    configurable: true,
    writable: true,
    value: {
      staffUser: { async findUnique() { return { isActive: active }; } },
      importBatch: { async findUnique() { work++; return null; } },
    },
  });
  after(() => {
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
    if (originalPrisma) Object.defineProperty(globalThis, "prisma", originalPrisma);
    else Reflect.deleteProperty(globalThis, "prisma");
  });
  const { GET, POST } = await import("../app/api/staff/imports/[id]/contact-recovery/route");
  const token = signStaffSessionToken({ staffUserId: 1, expiresAt: Date.now() + 60_000 });
  const request = (method: "GET" | "POST", authenticated: boolean) =>
    new NextRequest("http://localhost/api/staff/imports/1/contact-recovery", {
      method,
      headers: authenticated ? { cookie: `staff_session=${token}` } : {},
      ...(method === "POST" ? { body: JSON.stringify({ confirmed: true, fingerprint: "a".repeat(64) }) } : {}),
    });
  const context = { params: Promise.resolve({ id: "1" }) };
  assert.equal((await GET(request("GET", false), context)).status, 401);
  assert.equal((await POST(request("POST", false), context)).status, 401);
  assert.equal((await GET(request("GET", true), context)).status, 401);
  assert.equal((await POST(request("POST", true), context)).status, 401);
  assert.equal(work, 0);
  active = true;
  const unconfirmed = new NextRequest("http://localhost/api/staff/imports/1/contact-recovery", {
    method: "POST",
    headers: { cookie: `staff_session=${token}` },
    body: JSON.stringify({ fingerprint: "a".repeat(64) }),
  });
  assert.equal((await POST(unconfirmed, context)).status, 400);
  assert.equal(work, 0);
  assert.equal((await POST(request("POST", true), context)).status, 409);
  assert.equal(work, 1);
});
