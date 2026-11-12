import assert from "node:assert/strict";
import { after, test } from "node:test";

const originalSecret = process.env.CRON_SECRET;
const originalFlag = process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED;
const originalPrisma = Object.getOwnPropertyDescriptor(globalThis, "prisma");

after(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
  if (originalFlag === undefined) delete process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED;
  else process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = originalFlag;
  if (originalPrisma) Object.defineProperty(globalThis, "prisma", originalPrisma);
  else Reflect.deleteProperty(globalThis, "prisma");
});

test("cron requires its bearer secret and respects the disabled flag", async () => {
  let selections = 0;
  Object.defineProperty(globalThis, "prisma", {
    configurable: true, writable: true,
    value: { async $queryRaw() { selections++; return []; } },
  });
  const { GET } = await import("../app/api/cron/customer-contact-sync/route");
  const request = (authorization?: string) =>
    new Request("http://localhost/api/cron/customer-contact-sync", {
      headers: authorization ? { authorization } : {},
    });
  delete process.env.CRON_SECRET;
  assert.equal((await GET(request())).status, 503);
  process.env.CRON_SECRET = "test-cron-secret";
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  assert.equal((await GET(request())).status, 401);
  assert.equal((await GET(request("Bearer wrong"))).status, 401);
  assert.equal(selections, 0);

  delete process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED;
  const disabled = await GET(request("Bearer test-cron-secret"));
  assert.equal(disabled.status, 200);
  assert.equal((await disabled.json()).status, "disabled");
  assert.equal(selections, 0);

  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  const enabled = await GET(request("Bearer test-cron-secret"));
  assert.equal(enabled.status, 200);
  assert.equal((await enabled.json()).status, "completed");
  assert.equal(selections, 1);
});
