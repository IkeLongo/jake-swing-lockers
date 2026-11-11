import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  ContactResolutionError,
  upsertContact,
  updateContactProfile,
} from "../lib/ghl/contacts";
import { resolveSwingLockerCustomerContact } from "../lib/ghl/swingLockerContactResolution";

process.env.GHL_SWINGLOCKER_LOCATION_ID = "loc-1";
process.env.GHL_SWINGLOCKER_PRIVATE_TOKEN = "test-token";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface FetchCall {
  url: URL;
  method: string;
  body: string | null;
  headers: Headers;
}

type FetchResponder = (
  call: FetchCall,
) => Response | Promise<Response>;

function mockFetch(respond: FetchResponder): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = {
      url: new URL(String(input)),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : null,
      headers: new Headers(init?.headers),
    };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return calls;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const match = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  locationId: "loc-1",
  firstName: "Ann",
  lastName: "Lee",
  email: "ann@example.com",
  phone: "+12105550100",
  ...over,
});

function lookupResponder(options: {
  email?: unknown;
  phone?: unknown;
  contacts?: Record<string, unknown>;
  create?: () => Response | Promise<Response>;
} = {}) {
  return (call: FetchCall): Response | Promise<Response> => {
    if (call.url.pathname === "/contacts/lookup") {
      const email = call.url.searchParams.get("email");
      const phone = call.url.searchParams.get("phone");
      if (email) return json(options.email ?? { contacts: [] });
      if (phone) return json(options.phone ?? { contacts: [] });
      return json({ contacts: [] });
    }
    if (call.method === "POST") {
      return options.create?.() ?? json({ contact: { id: "created" } });
    }
    const id = decodeURIComponent(call.url.pathname.split("/").pop() ?? "");
    if (call.method === "PUT") {
      return json({ contact: { id } });
    }
    return json({ contact: options.contacts?.[id] ?? match(id) });
  };
}

async function assertResolutionError(
  promise: Promise<unknown>,
  code: ContactResolutionError["code"],
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ContactResolutionError);
    assert.equal(error.code, code);
    return true;
  });
}

test("email-only and phone-only GHL matches require staff review", async () => {
  const emailCalls = mockFetch(
    lookupResponder({ email: { contacts: [match("email-match")] } }),
  );
  await assertResolutionError(
    upsertContact({ email: "ann@example.com" }, null, {
      contactMatchPolicy: "require-review",
    }),
    "contact_match_requires_review",
  );
  assert.equal(emailCalls.some((call) => call.method === "POST"), false);

  const phoneCalls = mockFetch(
    lookupResponder({ phone: { contacts: [match("phone-match")] } }),
  );
  await assertResolutionError(
    upsertContact({ phone: "(210) 555-0100" }, null, {
      contactMatchPolicy: "require-review",
    }),
    "contact_match_requires_review",
  );
  assert.equal(phoneCalls.some((call) => call.method === "POST"), false);
});

test("email and phone are searched independently and a shared match is reviewed", async () => {
  const calls = mockFetch(
    lookupResponder({
      email: { contacts: [match("same")] },
      phone: { contacts: [match("same")] },
    }),
  );
  await assertResolutionError(
    upsertContact(
      { email: " ANN@example.com ", phone: "(210) 555-0100" },
      null,
      { contactMatchPolicy: "require-review" },
    ),
    "contact_match_requires_review",
  );
  const lookups = calls.filter((call) => call.url.pathname === "/contacts/lookup");
  assert.equal(lookups.length, 2);
  assert.equal(lookups[0]?.url.searchParams.get("email"), "ann@example.com");
  assert.equal(lookups[1]?.url.searchParams.get("phone"), "+12105550100");
  assert.ok(lookups.every((call) => call.headers.get("Version") === "v3"));
});

test("equivalent US phone formats use the same normalized GHL lookup", async () => {
  const calls = mockFetch(lookupResponder());
  await upsertContact({ phone: "210-555-0100" });
  await upsertContact({ phone: "+1 (210) 555-0100" });
  assert.deepEqual(
    calls
      .filter((call) => call.url.pathname === "/contacts/lookup")
      .map((call) => call.url.searchParams.get("phone")),
    ["+12105550100", "+12105550100"],
  );
});

test("email and phone matches on different contacts are an identity conflict", async () => {
  mockFetch(
    lookupResponder({
      email: { contacts: [match("email-match")] },
      phone: { contacts: [match("phone-match")] },
    }),
  );
  await assertResolutionError(
    upsertContact(
      { email: "ann@example.com", phone: "+12105550100" },
      null,
      { contactMatchPolicy: "require-review" },
    ),
    "identifier_conflict",
  );
});

test("missing one identifier is permitted and both missing are rejected", async () => {
  const emailCalls = mockFetch(lookupResponder());
  assert.deepEqual(await upsertContact({ email: " Ann@Example.com " }), {
    id: "created",
  });
  const create = emailCalls.find((call) => call.method === "POST");
  assert.deepEqual(JSON.parse(create?.body ?? "{}"), {
    locationId: "loc-1",
    email: "ann@example.com",
  });

  const phoneCalls = mockFetch(lookupResponder());
  assert.deepEqual(await upsertContact({ phone: "(210) 555-0100" }), {
    id: "created",
  });
  const phoneCreate = phoneCalls.find((call) => call.method === "POST");
  assert.deepEqual(JSON.parse(phoneCreate?.body ?? "{}"), {
    locationId: "loc-1",
    phone: "+12105550100",
  });

  const noIdentifierCalls = mockFetch(lookupResponder());
  await assertResolutionError(upsertContact({ email: " ", phone: null }), "missing_identifier");
  assert.equal(noIdentifierCalls.length, 0);
});

test("lookup failures and malformed responses cannot fall through to contact creation", async () => {
  const failingCalls = mockFetch((call) =>
    call.url.pathname === "/contacts/lookup"
      ? json({ message: "Unauthorized" }, 401)
      : json({ contact: { id: "unexpected" } }),
  );
  await assertResolutionError(
    upsertContact({ email: "ann@example.com", phone: "+12105550100" }),
    "lookup_unavailable",
  );
  assert.equal(failingCalls.some((call) => call.method === "POST"), false);

  const malformedCalls = mockFetch(
    lookupResponder({ email: { contacts: [{}] } }),
  );
  await assertResolutionError(
    upsertContact({ email: "ann@example.com" }),
    "lookup_unavailable",
  );
  assert.equal(malformedCalls.some((call) => call.method === "POST"), false);
});

test("ambiguous GHL matches block creation", async () => {
  const calls = mockFetch(
    lookupResponder({
      email: {
        contacts: [match("one"), match("two")],
      },
    }),
  );
  await assertResolutionError(
    upsertContact({ email: "ann@example.com" }),
    "multiple_matches",
  );
  assert.equal(calls.some((call) => call.method === "POST"), false);

  const incompleteCalls = mockFetch(
    lookupResponder({
      email: {
        contacts: [match("one")],
        nextCursor: "another-page",
      },
    }),
  );
  await assertResolutionError(
    upsertContact({ email: "ann@example.com" }),
    "multiple_matches",
  );
  assert.equal(incompleteCalls.some((call) => call.method === "POST"), false);
});

test("duplicate-on-create response requires review and is not retried", async () => {
  let createCount = 0;
  const calls = mockFetch(
    lookupResponder({
      create: () => {
        createCount += 1;
        return json(
          {
            message: "This location does not allow duplicated contacts",
            meta: { contactId: "existing", matchingField: "phone" },
          },
          400,
        );
      },
    }),
  );
  await assertResolutionError(
    upsertContact({ email: "new@example.com", phone: "+12105550100" }),
    "duplicate_on_create",
  );
  assert.equal(createCount, 1);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
});

test("a verified saved contact is updated without changing its link", async () => {
  const calls = mockFetch(
    lookupResponder({
      contacts: { saved: match("saved") },
    }),
  );
  const result = await upsertContact(
    { email: "ann@example.com", phone: "+12105550100" },
    "saved",
  );
  assert.deepEqual(result, { id: "saved" });
  assert.equal(calls.some((call) => call.method === "POST"), false);
  assert.equal(calls.some((call) => call.method === "PUT"), true);
});

test("profile-only update writes to the verified ID and never searches or creates", async () => {
  const calls = mockFetch(lookupResponder());

  assert.deepEqual(
    await updateContactProfile("verified-contact", {
      firstName: " Ann ",
      email: " ANN@example.com ",
      phone: "(210) 555-0100",
    }),
    { id: "verified-contact" },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url.pathname, "/contacts/verified-contact");
  assert.equal(calls[0]?.method, "PUT");
  assert.deepEqual(JSON.parse(calls[0]?.body ?? "{}"), {
    firstName: "Ann",
    email: "ann@example.com",
    phone: "+12105550100",
  });
});

test("editing identifiers on the same saved contact updates that contact", async () => {
  const previous = match("saved", { email: "old@example.com" });
  const calls = mockFetch((call) => {
    if (call.url.pathname === "/contacts/lookup") {
      return call.url.searchParams.has("phone")
        ? json({ contacts: [previous] })
        : json({ contacts: [] });
    }
    if (call.method === "PUT") return json({ contact: { id: "saved" } });
    return json({ contact: previous });
  });
  const result = await upsertContact(
    { email: "new@example.com", phone: "+12105550100" },
    "saved",
  );
  assert.deepEqual(result, { id: "saved" });
  assert.equal(calls.some((call) => call.method === "POST"), false);
  const update = calls.find((call) => call.method === "PUT");
  assert.deepEqual(JSON.parse(update?.body ?? "{}"), {
    email: "new@example.com",
    phone: "+12105550100",
  });
});

test("a saved contact cannot be reassigned to a different identifier match", async () => {
  const calls = mockFetch(
    lookupResponder({
      email: { contacts: [match("different")] },
      contacts: { saved: match("saved") },
    }),
  );
  await assertResolutionError(
    upsertContact({ email: "ann@example.com" }, "saved"),
    "identifier_conflict",
  );
  assert.equal(calls.some((call) => call.method === "PUT"), false);
});

test("a GHL contact already linked to another local customer cannot be updated", async () => {
  const calls = mockFetch(
    lookupResponder({
      contacts: { saved: match("saved") },
    }),
  );
  await assertResolutionError(
    upsertContact(
      { email: "ann@example.com" },
      "saved",
      {
        ownClientId: 10,
        findLinkedClients: async () => [
          {
            id: 11,
            firstName: "Other",
            lastName: "Customer",
            ghlContactId: "saved",
          },
        ],
      },
    ),
    "contact_owned_by_another_client",
  );
  assert.equal(calls.some((call) => call.method === "PUT"), false);
});

test("an uncertain create result is surfaced once without an automatic retry", async () => {
  let createCount = 0;
  const calls = mockFetch((call) => {
    if (call.url.pathname === "/contacts/lookup") return json({ contacts: [] });
    if (call.method === "POST") {
      createCount += 1;
      throw new Error("network timeout");
    }
    return json({ contact: { id: "unexpected" } });
  });

  await assert.rejects(
    upsertContact({ email: "new@example.com" }),
    /network timeout/,
  );
  assert.equal(createCount, 1);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
});

test("Swing Locker access requires an already linked GHL contact", async () => {
  const calls = mockFetch(lookupResponder());
  await assertResolutionError(
    resolveSwingLockerCustomerContact(
      {
        id: 10,
        firstName: "Ann",
        lastName: "Lee",
        email: "ann@example.com",
        phone: "+12105550100",
        ghlContactId: null,
      },
      async () => [],
    ),
    "contact_match_requires_review",
  );
  assert.equal(calls.length, 0);
});

test("Swing Locker access cannot update another customer's linked GHL contact", async () => {
  const calls = mockFetch(
    lookupResponder({
      contacts: { saved: match("saved") },
    }),
  );
  await assertResolutionError(
    resolveSwingLockerCustomerContact(
      {
        id: 10,
        firstName: "Ann",
        lastName: "Lee",
        email: "ann@example.com",
        phone: "+12105550100",
        ghlContactId: "saved",
      },
      async () => [
        {
          id: 11,
          firstName: "Other",
          lastName: "Customer",
          ghlContactId: "saved",
        },
      ],
    ),
    "contact_owned_by_another_client",
  );
  assert.equal(calls.some((call) => call.method === "PUT"), false);
  assert.equal(calls.some((call) => call.method === "POST"), false);
});

test("Swing Locker access preserves a verified saved contact link", async () => {
  const calls = mockFetch(
    lookupResponder({
      contacts: { saved: match("saved") },
    }),
  );
  const contactId = await resolveSwingLockerCustomerContact(
    {
      id: 10,
      firstName: "Ann",
      lastName: "Lee",
      email: "ann@example.com",
      phone: "+12105550100",
      ghlContactId: "saved",
    },
    async () => [],
  );
  assert.equal(contactId, "saved");
  assert.equal(calls.some((call) => call.method === "PUT"), true);
  assert.equal(calls.some((call) => call.method === "POST"), false);
});

test("Swing Locker access does not update a saved contact with no matching identifier", async () => {
  const calls = mockFetch(
    lookupResponder({
      contacts: {
        saved: match("saved", {
          email: "old@example.com",
          phone: "+12105550999",
        }),
      },
    }),
  );
  await assertResolutionError(
    resolveSwingLockerCustomerContact(
      {
        id: 10,
        firstName: "Ann",
        lastName: "Lee",
        email: "ann@example.com",
        phone: "+12105550100",
        ghlContactId: "saved",
      },
      async () => [],
    ),
    "identity_conflict",
  );
  assert.equal(calls.some((call) => call.method === "PUT"), false);
});
