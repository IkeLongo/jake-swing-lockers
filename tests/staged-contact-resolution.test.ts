import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ContactNeedsReviewError,
  resolveStagedContact,
  type ContactLookupPage,
  type GhlContactLite,
  type StagedContactApi,
  type StagedContactInput,
} from "../lib/ghl/resolveStagedContact";
import { GhlDuplicateContactError } from "../lib/ghl/client";

const LOCATION = "loc-1";

const INPUT: StagedContactInput = {
  firstName: "Ann",
  lastName: "Lee",
  email: "Ann@Example.com",
  phone: "(512) 555-0101",
};

interface FakeOpts {
  contacts?: Record<string, GhlContactLite>;
  byEmail?: GhlContactLite[];
  byPhone?: GhlContactLite[];
  emailHasMore?: boolean;
  failLookup?: "email" | "phone";
  failGet?: boolean;
  duplicateOnCreate?: boolean;
}

function fakeApi(opts: FakeOpts = {}) {
  const log = {
    gets: [] as string[],
    emailLookups: [] as string[],
    phoneLookups: [] as string[],
    creates: [] as Record<string, string>[],
    writes: 0,
  };
  const page = (contacts: GhlContactLite[] = [], hasMore = false): ContactLookupPage => ({
    contacts,
    hasMore,
  });
  const api: StagedContactApi = {
    async getContact(id) {
      log.gets.push(id);
      if (opts.failGet) throw new Error("GHL API error: 500");
      return opts.contacts?.[id] ?? null;
    },
    async lookupByEmail(email) {
      log.emailLookups.push(email);
      if (opts.failLookup === "email") throw new Error("GHL API error: 503");
      return page(opts.byEmail, opts.emailHasMore);
    },
    async lookupByPhone(phone) {
      log.phoneLookups.push(phone);
      if (opts.failLookup === "phone") throw new Error("GHL API error: 503");
      return page(opts.byPhone);
    },
    async createContact(input) {
      log.creates.push(input as Record<string, string>);
      if (opts.duplicateOnCreate) throw new GhlDuplicateContactError("dup-1", "email");
      return { id: "created-1" };
    },
    locationId: () => LOCATION,
  };
  return { api, log };
}

const contact = (over: Partial<GhlContactLite> = {}): GhlContactLite => ({
  id: "c1",
  locationId: LOCATION,
  firstName: "Ann",
  lastName: "Lee",
  email: "ann@example.com",
  phone: "+15125550101",
  ...over,
});

async function needsReview(promise: Promise<unknown>, reason: string) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof ContactNeedsReviewError);
    assert.equal((err as ContactNeedsReviewError).code, "contact-needs-review");
    assert.equal((err as ContactNeedsReviewError).reason, reason);
    return true;
  });
}

test("a valid saved contact ID is verified and reused without searching", async () => {
  const f = fakeApi({ contacts: { c1: contact() } });
  const r = await resolveStagedContact(f.api, INPUT, "c1");
  assert.deepEqual(r, { id: "c1", source: "saved" });
  assert.deepEqual(f.log.gets, ["c1"]);
  assert.equal(f.log.emailLookups.length + f.log.phoneLookups.length, 0);
  assert.equal(f.log.creates.length, 0);
});

test("a saved ID from another location needs review", async () => {
  const f = fakeApi({ contacts: { c1: contact({ locationId: "other" }) } });
  await needsReview(resolveStagedContact(f.api, INPUT, "c1"), "wrong_location");
});

test("a stale saved ID falls back to search and is replaced", async () => {
  const f = fakeApi({ byEmail: [contact({ id: "c9" })], byPhone: [contact({ id: "c9" })] });
  const r = await resolveStagedContact(f.api, INPUT, "gone");
  assert.deepEqual(r, { id: "c9", source: "email_and_phone" });
});

test("a failed saved-ID verification is retryable, not treated as stale", async () => {
  const f = fakeApi({ failGet: true });
  await assert.rejects(resolveStagedContact(f.api, INPUT, "c1"), (err) => {
    assert.ok(!(err instanceof ContactNeedsReviewError));
    return true;
  });
  assert.equal(f.log.creates.length, 0);
});

test("normalized email and phone are what gets searched", async () => {
  const f = fakeApi();
  await resolveStagedContact(f.api, INPUT, null);
  assert.deepEqual(f.log.emailLookups, ["ann@example.com"]);
  assert.deepEqual(f.log.phoneLookups, ["+15125550101"]);
});

test("unique email match is reused", async () => {
  const f = fakeApi({ byEmail: [contact()] });
  assert.deepEqual(await resolveStagedContact(f.api, INPUT, null), { id: "c1", source: "email" });
  assert.equal(f.log.creates.length, 0);
});

test("unique phone match is reused", async () => {
  const f = fakeApi({ byPhone: [contact()] });
  assert.deepEqual(await resolveStagedContact(f.api, INPUT, null), { id: "c1", source: "phone" });
});

test("the same contact for email and phone is reused", async () => {
  const f = fakeApi({ byEmail: [contact()], byPhone: [contact()] });
  assert.deepEqual(await resolveStagedContact(f.api, INPUT, null), {
    id: "c1",
    source: "email_and_phone",
  });
});

test("email and phone resolving to different contacts needs review", async () => {
  const f = fakeApi({ byEmail: [contact()], byPhone: [contact({ id: "c2" })] });
  await needsReview(resolveStagedContact(f.api, INPUT, null), "identifier_conflict");
  assert.equal(f.log.creates.length, 0);
});

test("multiple matches, or more pages, need review", async () => {
  const many = fakeApi({ byEmail: [contact(), contact({ id: "c2" })] });
  await needsReview(resolveStagedContact(many.api, INPUT, null), "multiple_matches");

  const more = fakeApi({ byEmail: [contact()], emailHasMore: true });
  await needsReview(resolveStagedContact(more.api, INPUT, null), "multiple_matches");

  const phones = fakeApi({ byPhone: [contact(), contact({ id: "c2" })] });
  await needsReview(resolveStagedContact(phones.api, INPUT, null), "multiple_matches");
});

test("a single match with conflicting identity needs review", async () => {
  const otherPhone = fakeApi({ byEmail: [contact({ phone: "+15125559999" })] });
  await needsReview(resolveStagedContact(otherPhone.api, INPUT, null), "identity_conflict");

  const otherEmail = fakeApi({ byPhone: [contact({ email: "someone@else.com" })] });
  await needsReview(resolveStagedContact(otherEmail.api, INPUT, null), "identity_conflict");

  const otherName = fakeApi({ byEmail: [contact({ lastName: "Smith" })] });
  await needsReview(resolveStagedContact(otherName.api, INPUT, null), "identity_conflict");
});

test("missing identity fields on the existing contact are not conflicts", async () => {
  const f = fakeApi({ byEmail: [contact({ phone: null, firstName: "", lastName: undefined })] });
  assert.equal((await resolveStagedContact(f.api, INPUT, null)).id, "c1");
});

test("a lookup failure is retryable and never creates a contact", async () => {
  for (const failLookup of ["email", "phone"] as const) {
    const f = fakeApi({ failLookup });
    await assert.rejects(resolveStagedContact(f.api, INPUT, null), (err) => {
      assert.ok(!(err instanceof ContactNeedsReviewError));
      return true;
    });
    assert.equal(f.log.creates.length, 0);
  }
});

test("no match creates a contact with normalized identifiers", async () => {
  const f = fakeApi();
  assert.deepEqual(await resolveStagedContact(f.api, INPUT, null), {
    id: "created-1",
    source: "created",
  });
  assert.deepEqual(f.log.creates, [
    { firstName: "Ann", lastName: "Lee", email: "ann@example.com", phone: "+15125550101" },
  ]);
});

test("a duplicate rejection on create needs review instead of silent reuse", async () => {
  const f = fakeApi({ duplicateOnCreate: true });
  await needsReview(resolveStagedContact(f.api, INPUT, null), "duplicate_on_create");
});

test("missing or unusable identifiers are rejected before any GHL call", async () => {
  for (const input of [
    { ...INPUT, email: null, phone: null },
    { ...INPUT, email: "not-an-email", phone: "12345" },
  ]) {
    const f = fakeApi();
    await needsReview(resolveStagedContact(f.api, input, null), "missing_identifier");
    assert.equal(
      f.log.emailLookups.length + f.log.phoneLookups.length + f.log.creates.length,
      0,
    );
  }
});

test("only the usable identifier is searched and sent", async () => {
  const f = fakeApi();
  await resolveStagedContact(f.api, { ...INPUT, phone: "12345" }, null);
  assert.equal(f.log.phoneLookups.length, 0);
  assert.deepEqual(Object.keys(f.log.creates[0]).sort(), ["email", "firstName", "lastName"]);
});

test("reusing a contact never writes to it", async () => {
  const f = fakeApi({ byEmail: [contact()], byPhone: [contact()] });
  await resolveStagedContact(f.api, INPUT, null);
  // The API surface has no update method; the only write is create.
  assert.equal(f.log.creates.length, 0);
  assert.equal(f.log.writes, 0);
});

test("retry after a partial sync reuses the saved contact", async () => {
  const f = fakeApi();
  const first = await resolveStagedContact(f.api, INPUT, null);
  assert.equal(first.source, "created");

  // Second attempt: the saved ID now exists in GHL, so no search or create.
  const retryApi = fakeApi({ contacts: { [first.id]: contact({ id: first.id }) } });
  const second = await resolveStagedContact(retryApi.api, INPUT, first.id);
  assert.deepEqual(second, { id: "created-1", source: "saved" });
  assert.equal(retryApi.log.creates.length, 0);
  assert.equal(f.log.creates.length, 1);
});
