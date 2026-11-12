import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createStagedContactApi, stagedContactApi } from "../lib/ghl/stagedContactApi";

process.env.GHL_SWINGLOCKER_LOCATION_ID = "loc-1";
process.env.GHL_SWINGLOCKER_PRIVATE_TOKEN = "test-token";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Seen {
  url: URL;
  headers: Record<string, string>;
  method: string;
}

function mockFetch(status: number, body: unknown): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({
      url: new URL(String(input)),
      headers: (init?.headers ?? {}) as Record<string, string>,
      method: init?.method ?? "GET",
    });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return seen;
}

test("lookup uses GET /contacts/lookup with Version v3, location scope and limit", async () => {
  const seen = mockFetch(200, { contacts: [{ id: "c1" }] });
  const page = await stagedContactApi.lookupByEmail("a@b.co");
  assert.equal(seen[0].method, "GET");
  assert.equal(seen[0].url.pathname, "/contacts/lookup");
  assert.equal(seen[0].headers.Version, "v3");
  assert.equal(seen[0].url.searchParams.get("locationId"), "loc-1");
  assert.equal(seen[0].url.searchParams.get("email"), "a@b.co");
  assert.equal(seen[0].url.searchParams.get("limit"), "2");
  assert.equal(seen[0].url.searchParams.has("phone"), false);
  assert.deepEqual(page, { contacts: [{ id: "c1" }], hasMore: false });
});

test("phone lookup sends only phone; nextCursor means more results", async () => {
  const seen = mockFetch(200, { contacts: [{ id: "c1" }, { id: "c2" }], nextCursor: "abc" });
  const page = await stagedContactApi.lookupByPhone("+15125550101");
  assert.equal(seen[0].url.searchParams.get("phone"), "+15125550101");
  assert.equal(seen[0].url.searchParams.has("email"), false);
  assert.equal(page.hasMore, true);
  assert.equal(page.contacts.length, 2);
});

test("customer processor requests carry their supplied deadline signal", async () => {
  const controller = new AbortController();
  const seen: (AbortSignal | null | undefined)[] = [];
  globalThis.fetch = (async (_input, init) => {
    seen.push(init?.signal);
    return new Response(JSON.stringify({ contacts: [] }), { status: 200 });
  }) as typeof fetch;
  await createStagedContactApi(() => controller.signal).lookupByEmail("a@b.co");
  assert.deepEqual(seen, [controller.signal]);
});

test("lookup errors and malformed responses throw instead of meaning no match", async () => {
  mockFetch(400, { error: "bad" });
  await assert.rejects(stagedContactApi.lookupByEmail("a@b.co"));
  mockFetch(200, { nope: true });
  await assert.rejects(stagedContactApi.lookupByEmail("a@b.co"));
});

test("getContact treats GHL's 400/404 not-found as missing, other errors as failures", async () => {
  mockFetch(400, { error: "Contact with id zzz not found", status: 400 });
  assert.equal(await stagedContactApi.getContact("zzz"), null);
  mockFetch(404, { error: "Not Found" });
  assert.equal(await stagedContactApi.getContact("zzz"), null);
  mockFetch(500, { error: "boom" });
  await assert.rejects(stagedContactApi.getContact("zzz"));
  mockFetch(401, { error: "Unauthorized" });
  await assert.rejects(stagedContactApi.getContact("zzz"));
  mockFetch(200, { contact: { id: "c1", locationId: "loc-1" } });
  assert.equal((await stagedContactApi.getContact("c1"))?.id, "c1");
});
