import assert from "node:assert/strict";
import test from "node:test";
import {
  ContactDiscoveryUnavailableError,
  type DiscoveryApi,
  type DiscoveryDeps,
  type DiscoveryInput,
  type LinkedClientRow,
} from "../lib/ghl/discoverStagedContacts";
import { matchGhlContact } from "../lib/ghl/matchGhlContact";
import type { GhlContactLite } from "../lib/ghl/resolveStagedContact";

const LOCATION = "loc-1";
const INPUT: DiscoveryInput = {
  identity: {
    firstName: "Ann",
    lastName: "Lee",
    email: " Ann@Example.com ",
    phone: "(210) 555-0100",
  },
  savedContactId: null,
  ownClientId: null,
};

const contact = (
  id: string,
  over: Partial<GhlContactLite> = {},
): GhlContactLite => ({
  id,
  locationId: LOCATION,
  firstName: "Ann",
  lastName: "Lee",
  email: "ann@example.com",
  phone: "+12105550100",
  ...over,
});

interface MockOptions {
  saved?: GhlContactLite | null;
  byEmail?: { contacts: GhlContactLite[]; hasMore?: boolean };
  byPhone?: { contacts: GhlContactLite[]; hasMore?: boolean };
  linked?: LinkedClientRow[];
  fail?: "email" | "phone" | "get";
}

function mock(options: MockOptions = {}) {
  const calls: string[] = [];
  const api: DiscoveryApi = {
    locationId: () => LOCATION,
    async getContact(id) {
      calls.push(`get:${id}`);
      if (options.fail === "get") throw new Error("GHL API error: 500");
      return options.saved ?? null;
    },
    async lookupByEmail(email) {
      calls.push(`email:${email}`);
      if (options.fail === "email") throw new Error("GHL API error: 503");
      return {
        contacts: options.byEmail?.contacts ?? [],
        hasMore: options.byEmail?.hasMore ?? false,
      };
    },
    async lookupByPhone(phone) {
      calls.push(`phone:${phone}`);
      if (options.fail === "phone") throw new Error("GHL API error: 503");
      return {
        contacts: options.byPhone?.contacts ?? [],
        hasMore: options.byPhone?.hasMore ?? false,
      };
    },
  };
  const deps: DiscoveryDeps = {
    api,
    findLinkedClients: async (ids) =>
      (options.linked ?? []).filter(
        (row) => row.ghlContactId && ids.includes(row.ghlContactId),
      ),
  };
  return { deps, calls };
}

test("matches one clear contact using normalized email and US phone", async () => {
  const { deps, calls } = mock({
    byEmail: { contacts: [contact("c1")] },
    byPhone: { contacts: [contact("c1")] },
  });

  const result = await matchGhlContact(deps, INPUT);

  assert.equal(result.status, "matched");
  if (result.status !== "matched") return;
  assert.equal(result.contact.id, "c1");
  assert.deepEqual(calls.sort(), [
    "email:ann@example.com",
    "phone:+12105550100",
  ]);
});

test("returns no_match only after complete identifier lookups", async () => {
  const { deps } = mock();

  const result = await matchGhlContact(deps, INPUT);

  assert.equal(result.status, "no_match");
  if (result.status === "no_match") {
    assert.equal(result.discovery.flags.incomplete, false);
  }
});

test("conflicting identifier matches require review", async () => {
  const { deps } = mock({
    byEmail: { contacts: [contact("email-contact")] },
    byPhone: { contacts: [contact("phone-contact")] },
  });

  const result = await matchGhlContact(deps, INPUT);

  assert.equal(result.status, "needs_review");
  if (result.status === "needs_review") {
    assert.equal(result.reason, "discovery_requires_review");
    assert.equal(result.discovery?.flags.identifierConflict, true);
  }
});

test("multiple or incomplete results require review", async () => {
  for (const byEmail of [
    { contacts: [contact("c1"), contact("c2")] },
    { contacts: [contact("c1")], hasMore: true },
  ]) {
    const { deps } = mock({ byEmail });
    const result = await matchGhlContact(deps, INPUT);
    assert.equal(result.status, "needs_review");
  }
});

test("lookup failures reject instead of becoming no_match", async () => {
  for (const fail of ["email", "phone"] as const) {
    const { deps } = mock({ fail });
    await assert.rejects(
      matchGhlContact(deps, INPUT),
      ContactDiscoveryUnavailableError,
    );
  }
});

test("a contact linked to another GolfClient requires review", async () => {
  const { deps } = mock({
    byEmail: { contacts: [contact("c1")] },
    linked: [
      { id: 42, firstName: "Another", lastName: "Customer", ghlContactId: "c1" },
    ],
  });

  const result = await matchGhlContact(deps, INPUT);

  assert.equal(result.status, "needs_review");
  if (result.status === "needs_review") {
    assert.equal(result.discovery?.flags.linkedElsewhere, true);
  }
});

test("unverified location and unsupported international phone do not match", async () => {
  const unverified = mock({
    byEmail: { contacts: [contact("c1", { locationId: null })] },
  });
  const locationResult = await matchGhlContact(unverified.deps, INPUT);
  assert.equal(locationResult.status, "needs_review");

  const international = mock();
  const phoneResult = await matchGhlContact(international.deps, {
    ...INPUT,
    identity: { ...INPUT.identity, phone: "+442071234567" },
  });
  assert.equal(phoneResult.status, "needs_review");
  assert.deepEqual(international.calls, []);
});

test("linked profile changes permit only discrepancies on the verified saved contact", async () => {
  const saved = contact("saved");
  for (const change of [
    { firstName: "Anne" },
    { email: "new@example.com" },
    { phone: "(210) 555-0199" },
  ]) {
    const identity = { ...INPUT.identity, ...change };
    const { deps, calls } = mock({
      saved,
      byEmail: { contacts: change.email ? [] : [saved] },
      byPhone: { contacts: change.phone ? [] : [saved] },
    });
    const input = { identity, savedContactId: saved.id, ownClientId: 7 };
    const result = await matchGhlContact(deps, input, {
      allowLinkedProfileDifferences: true,
    });
    assert.equal(result.status, "matched");
    if (result.status === "matched") {
      assert.equal(result.contact.id, saved.id);
      assert.equal(result.discovery.flags.identityConflict, true);
    }
    assert.equal(calls[0], "get:saved");
    assert.equal((await matchGhlContact(deps, input)).status, "needs_review");
  }
});

test("linked profile verification retains the saved location when lookup results omit it", async () => {
  const saved = contact("saved");
  const lookup = contact("saved", { locationId: undefined });
  const result = await matchGhlContact(
    mock({ saved, byEmail: { contacts: [lookup] }, byPhone: { contacts: [lookup] } }).deps,
    {
      ...INPUT,
      identity: { ...INPUT.identity, firstName: "Anne" },
      savedContactId: saved.id,
      ownClientId: 7,
    },
    { allowLinkedProfileDifferences: true },
  );
  assert.equal(result.status, "matched");
});

test("linked profile verification rejects missing, wrong, or unowned saved contacts", async () => {
  const input = {
    ...INPUT,
    identity: { ...INPUT.identity, firstName: "Anne" },
    savedContactId: "saved",
    ownClientId: 7,
  };
  const saved = contact("saved");
  const cases: MockOptions[] = [
    { byEmail: { contacts: [saved] } },
    { saved: contact("other") },
    { saved: contact("saved", { locationId: "other-location" }) },
    { saved: contact("saved", { locationId: null }) },
    { saved, linked: [{ id: 8, firstName: "Other", lastName: null, ghlContactId: "saved" }] },
  ];
  for (const options of cases) {
    const result = await matchGhlContact(mock(options).deps, input, {
      allowLinkedProfileDifferences: true,
    });
    assert.equal(result.status, "needs_review");
  }
  const noOwner = await matchGhlContact(mock({ saved }).deps, {
    ...input, ownClientId: null,
  }, { allowLinkedProfileDifferences: true });
  assert.equal(noOwner.status, "needs_review");
});

test("linked profile verification never accepts competing or incomplete identifier results", async () => {
  const saved = contact("saved");
  const input = {
    ...INPUT,
    identity: { ...INPUT.identity, email: "new@example.com" },
    savedContactId: saved.id,
    ownClientId: 7,
  };
  for (const options of [
    { saved, byEmail: { contacts: [contact("other")] } },
    { saved, byPhone: { contacts: [contact("other")] } },
    { saved, byEmail: { contacts: [saved], hasMore: true } },
    { saved, byEmail: { contacts: [saved, contact("other")] } },
  ]) {
    const result = await matchGhlContact(mock(options).deps, input, {
      allowLinkedProfileDifferences: true,
    });
    assert.equal(result.status, "needs_review");
  }
  await assert.rejects(
    matchGhlContact(mock({ saved, fail: "phone" }).deps, input, {
      allowLinkedProfileDifferences: true,
    }),
    ContactDiscoveryUnavailableError,
  );
});

test("unlinked discovery still rejects differing profile details", async () => {
  const result = await matchGhlContact(
    mock({ byEmail: { contacts: [contact("other", { firstName: "Other" })] } }).deps,
    INPUT,
    { allowLinkedProfileDifferences: true },
  );
  assert.equal(result.status, "needs_review");
});
