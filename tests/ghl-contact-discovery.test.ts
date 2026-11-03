import test from "node:test";
import assert from "node:assert/strict";
import {
  ContactDiscoveryUnavailableError,
  discoverStagedContacts,
  type DiscoveryApi,
  type DiscoveryDeps,
  type LinkedClientRow,
} from "@/lib/ghl/discoverStagedContacts";
import {
  discoverContactForBatch,
  type BatchDiscoveryDeps,
  type DiscoveryBatchRow,
  type DiscoveryClientRow,
} from "@/lib/ghl/discoverBatchContact";
import type { GhlContactLite } from "@/lib/ghl/resolveStagedContact";
import { discoveryNotices } from "@/lib/ghl/discoveryComparison";
import { buildNewCustomerReview } from "@/lib/imports/new-customer-review-server";

const LOC = "loc-1";
const identity = {
  firstName: "Ann",
  lastName: "Lee",
  email: "ann@example.com",
  phone: "+12105550100",
};

const contact = (id: string, over: Partial<GhlContactLite> = {}): GhlContactLite => ({
  id,
  locationId: LOC,
  firstName: "Ann",
  lastName: "Lee",
  email: "ann@example.com",
  phone: "+12105550100",
  ...over,
});

interface MockOpts {
  byEmail?: { contacts: GhlContactLite[]; hasMore?: boolean };
  byPhone?: { contacts: GhlContactLite[]; hasMore?: boolean };
  saved?: Record<string, GhlContactLite | null>;
  fail?: "email" | "phone" | "get";
  linked?: LinkedClientRow[];
}

// The mock exposes only read methods; there is nothing to create or update.
function mock(opts: MockOpts = {}) {
  const calls: string[] = [];
  const api: DiscoveryApi = {
    locationId: () => LOC,
    async getContact(id) {
      calls.push(`get:${id}`);
      if (opts.fail === "get") throw new Error("GHL API error: 500");
      return opts.saved?.[id] ?? null;
    },
    async lookupByEmail(email) {
      calls.push(`email:${email}`);
      if (opts.fail === "email") throw new Error("GHL API error: 503");
      return { contacts: opts.byEmail?.contacts ?? [], hasMore: opts.byEmail?.hasMore ?? false };
    },
    async lookupByPhone(phone) {
      calls.push(`phone:${phone}`);
      if (opts.fail === "phone") throw new Error("GHL API error: 503");
      return { contacts: opts.byPhone?.contacts ?? [], hasMore: opts.byPhone?.hasMore ?? false };
    },
  };
  const deps: DiscoveryDeps = {
    api,
    findLinkedClients: async (ids) =>
      (opts.linked ?? []).filter((c) => c.ghlContactId && ids.includes(c.ghlContactId)),
  };
  return { deps, calls };
}

const run = (opts: MockOpts, over: Partial<Parameters<typeof discoverStagedContacts>[1]> = {}) => {
  const m = mock(opts);
  return discoverStagedContacts(m.deps, {
    identity,
    savedContactId: null,
    ownClientId: null,
    ...over,
  }).then((d) => ({ d, calls: m.calls }));
};

test("no matches is a definitive no_match", async () => {
  const { d, calls } = await run({});
  assert.equal(d.status, "no_match");
  assert.deepEqual(d.candidates, []);
  assert.deepEqual(calls.sort(), ["email:ann@example.com", "phone:+12105550100"]);
});

test("exact email match", async () => {
  const { d } = await run({
    byEmail: { contacts: [contact("c1", { phone: null })] },
  });
  assert.equal(d.status, "single_match");
  assert.deepEqual(d.candidates[0]!.reasons, ["email"]);
  assert.deepEqual(d.candidates[0]!.discrepancies, []);
});

test("exact phone match", async () => {
  const { d } = await run({ byPhone: { contacts: [contact("c1", { email: null })] } });
  assert.equal(d.status, "single_match");
  assert.deepEqual(d.candidates[0]!.reasons, ["phone"]);
});

test("same contact by email and phone is deduplicated", async () => {
  const { d } = await run({
    byEmail: { contacts: [contact("c1")] },
    byPhone: { contacts: [contact("c1")] },
  });
  assert.equal(d.candidates.length, 1);
  assert.deepEqual(d.candidates[0]!.reasons, ["email", "phone"]);
  assert.equal(d.status, "single_match");
});

test("email and phone matching different contacts is an identifier conflict", async () => {
  const { d } = await run({
    byEmail: { contacts: [contact("c1", { phone: "+12105559999" })] },
    byPhone: { contacts: [contact("c2", { email: "other@example.com" })] },
  });
  assert.equal(d.status, "needs_review");
  assert.equal(d.flags.identifierConflict, true);
  assert.equal(d.candidates.length, 2);
});

test("multiple contacts for one identifier", async () => {
  const { d } = await run({
    byEmail: { contacts: [contact("c1"), contact("c2")] },
  });
  assert.equal(d.status, "needs_review");
  assert.equal(d.flags.multipleMatches, true);
  assert.equal(d.flags.identifierConflict, false);
});

test("identity conflicts are reported per field", async () => {
  const { d } = await run({
    byEmail: {
      contacts: [contact("c1", { firstName: "Bob", phone: "+12105559999" })],
    },
  });
  assert.equal(d.status, "needs_review");
  assert.equal(d.flags.identityConflict, true);
  assert.deepEqual(d.candidates[0]!.discrepancies.sort(), ["firstName", "phone"]);
});

test("phone match with a different email is a discrepancy, not a silent match", async () => {
  const { d } = await run({
    byPhone: { contacts: [contact("c1", { email: "different@example.com" })] },
  });
  assert.equal(d.status, "needs_review");
  assert.deepEqual(d.candidates[0]!.discrepancies, ["email"]);
});

test("a missing field on the contact is not a conflict", async () => {
  const { d } = await run({
    byEmail: { contacts: [contact("c1", { phone: null, lastName: null })] },
  });
  assert.equal(d.status, "single_match");
});

test("wrong GHL location is flagged", async () => {
  const { d } = await run({
    byEmail: { contacts: [contact("c1", { locationId: "other-loc" })] },
  });
  assert.equal(d.status, "needs_review");
  assert.equal(d.flags.wrongLocation, true);
  assert.equal(d.candidates[0]!.wrongLocation, true);
});

test("contact already linked to another GolfClient is flagged", async () => {
  const { d } = await run({
    byEmail: { contacts: [contact("c1")] },
    linked: [{ id: 42, firstName: "Zed", lastName: "Q", ghlContactId: "c1" }],
  });
  assert.equal(d.status, "needs_review");
  assert.equal(d.flags.linkedElsewhere, true);
  assert.deepEqual(d.candidates[0]!.linkedClients, [{ id: 42, name: "Zed Q" }]);
});

test("the selected GolfClient's own link is not 'linked elsewhere'", async () => {
  const { d } = await run(
    {
      saved: { c1: contact("c1") },
      byEmail: { contacts: [contact("c1")] },
      linked: [{ id: 10, firstName: "Ann", lastName: "Lee", ghlContactId: "c1" }],
    },
    { savedContactId: "c1", ownClientId: 10 },
  );
  assert.equal(d.status, "single_match");
  assert.equal(d.savedLink.status, "verified");
  assert.deepEqual(d.candidates[0]!.reasons, ["saved_link", "email"]);
  assert.deepEqual(d.candidates[0]!.linkedClients, []);
});

test("lookup failure throws instead of reporting no match", async () => {
  for (const fail of ["email", "phone", "get"] as const) {
    await assert.rejects(
      run({ fail }, { savedContactId: "c1" }),
      ContactDiscoveryUnavailableError,
      fail,
    );
  }
});

test("a partial failure (email ok, phone fails) is not a no-match", async () => {
  await assert.rejects(run({ fail: "phone", byEmail: { contacts: [] } }), ContactDiscoveryUnavailableError);
});

test("hasMore is incomplete, never a definitive no_match", async () => {
  const empty = await run({ byEmail: { contacts: [], hasMore: true } });
  assert.equal(empty.d.status, "needs_review");
  assert.equal(empty.d.flags.incomplete, true);

  const one = await run({ byPhone: { contacts: [contact("c1")], hasMore: true } });
  assert.equal(one.d.status, "needs_review");
  assert.equal(one.d.flags.incomplete, true);
});

test("saved id that no longer exists in GHL is flagged", async () => {
  const { d } = await run({ saved: { gone: null } }, { savedContactId: "gone" });
  assert.equal(d.savedLink.status, "missing");
  assert.equal(d.flags.savedLinkMissing, true);
  assert.equal(d.status, "needs_review");
});

test("saved contact in a different location is flagged", async () => {
  const { d } = await run(
    { saved: { c1: contact("c1", { locationId: "other-loc" }) } },
    { savedContactId: "c1" },
  );
  assert.equal(d.savedLink.status, "wrong_location");
  assert.equal(d.flags.wrongLocation, true);
});

test("saved contact without a location is not labeled verified", async () => {
  const { d } = await run(
    { saved: { c1: contact("c1", { locationId: undefined }) } },
    { savedContactId: "c1" },
  );
  assert.equal(d.savedLink.status, "unverified_location");
  assert.equal(d.candidates[0]!.locationVerified, false);
  assert.ok(discoveryNotices(d).some((n) => /did not confirm the location/.test(n)));
});

test("saved contact differing from search matches needs review", async () => {
  const { d } = await run(
    { saved: { c1: contact("c1") }, byEmail: { contacts: [contact("c2")] } },
    { savedContactId: "c1" },
  );
  assert.equal(d.status, "needs_review");
  assert.equal(d.flags.savedLinkMismatch, true);
});

test("unusable identifiers are not searched and are reported", async () => {
  const m = mock({});
  const d = await discoverStagedContacts(m.deps, {
    identity: { ...identity, email: null, phone: "12345" },
    savedContactId: null,
    ownClientId: null,
  });
  assert.equal(d.status, "no_identifier");
  assert.deepEqual(d.unsearchable, ["phone"]);
  assert.deepEqual(m.calls, []);
});

// ── Batch-level discovery (existing and staged new customers) ────────────────

const batchRow = (over: Partial<DiscoveryBatchRow> = {}): DiscoveryBatchRow => ({
  id: 1,
  parserMode: "trackman-result",
  demoSessionId: null,
  customerResolution: "new",
  selectedGolfClientId: null,
  proposedFirstName: "Ann",
  proposedLastName: "Lee",
  proposedEmail: "ann@example.com",
  proposedPhone: "+12105550100",
  newCustomerConfirmationSignature: null,
  ...over,
});

function batchDeps(
  batch: DiscoveryBatchRow | null,
  opts: MockOpts & {
    client?: DiscoveryClientRow | null;
    localClients?: { id: number; firstName: string | null; lastName: string | null; email: string | null; phone: string | null }[];
  } = {},
) {
  const m = mock(opts);
  const deps: BatchDiscoveryDeps = {
    ...m.deps,
    loadBatch: async () => batch,
    loadClient: async () => opts.client ?? null,
    loadDuplicateClients: async () => opts.localClients ?? [],
  };
  return { deps, calls: m.calls };
}

test("staged new customer is discovered from persisted ImportBatch identifiers", async () => {
  const { deps, calls } = batchDeps(batchRow(), { byEmail: { contacts: [contact("c1")] } });
  const r = await discoverContactForBatch(deps, 1);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.customer, "new");
  assert.deepEqual(r.localCustomer, {
    id: null,
    firstName: "Ann",
    lastName: "Lee",
    email: "ann@example.com",
    phone: "+12105550100",
  });
  assert.equal(r.discovery.status, "single_match");
  assert.ok(calls.includes("email:ann@example.com"));
  assert.ok(calls.includes("phone:+12105550100"));
  assert.equal(calls.some((c) => c.startsWith("get:")), false);
});

test("existing GolfClient uses stored identifiers and verifies its saved ghlContactId", async () => {
  const { deps, calls } = batchDeps(
    batchRow({ customerResolution: "existing", selectedGolfClientId: 10, proposedEmail: null, proposedFirstName: null, proposedLastName: null, proposedPhone: null }),
    {
      client: {
        id: 10,
        firstName: "Ann",
        lastName: "Lee",
        email: "Ann@Example.com",
        phone: "(210) 555-0100",
        ghlContactId: "c1",
      },
      saved: { c1: contact("c1") },
      byEmail: { contacts: [contact("c1")] },
      byPhone: { contacts: [contact("c1")] },
    },
  );
  const r = await discoverContactForBatch(deps, 1);
  assert.equal(r.ok && r.discovery.status, "single_match");
  assert.equal(r.ok && r.localCustomer.id, 10);
  assert.ok(calls.includes("get:c1"));
  assert.ok(calls.includes("email:ann@example.com"));
  assert.ok(calls.includes("phone:+12105550100"));
});

test("discovery is refused before the customer is saved", async () => {
  const { deps, calls } = batchDeps(
    batchRow({ customerResolution: null, proposedFirstName: null, proposedEmail: null, proposedPhone: null }),
  );
  const r = await discoverContactForBatch(deps, 1);
  assert.equal(!r.ok && r.code, "customer_unresolved");
  assert.deepEqual(calls, []);
});

test("discovery is refused while a local duplicate review is unresolved", async () => {
  const { deps, calls } = batchDeps(batchRow(), {
    localClients: [{ id: 7, firstName: "X", lastName: "Y", email: "ann@example.com", phone: null }],
  });
  const r = await discoverContactForBatch(deps, 1);
  assert.equal(!r.ok && r.code, "local_review_required");
  assert.deepEqual(calls, []);
});

test("discovery proceeds once a valid local confirmation exists", async () => {
  const localClients = [{ id: 7, firstName: "X", lastName: "Y", email: "ann@example.com", phone: null }];
  const { signature } = buildNewCustomerReview(
    localClients,
    { email: "ann@example.com", phone: "+12105550100" },
    null,
  );
  const { deps } = batchDeps(batchRow({ newCustomerConfirmationSignature: signature }), { localClients });
  const r = await discoverContactForBatch(deps, 1);
  assert.equal(r.ok, true);
});

test("missing, finalized, and non-TrackMan batches are rejected", async () => {
  assert.equal((await discoverContactForBatch(batchDeps(null).deps, 1)).ok, false);
  const finalized = await discoverContactForBatch(batchDeps(batchRow({ demoSessionId: 5 })).deps, 1);
  assert.equal(!finalized.ok && finalized.code, "not_stageable");
  const other = await discoverContactForBatch(batchDeps(batchRow({ parserMode: "legacy" })).deps, 1);
  assert.equal(!other.ok && other.code, "not_stageable");
});

test("a GHL failure at batch level propagates as unavailable", async () => {
  const { deps } = batchDeps(batchRow(), { fail: "email" });
  await assert.rejects(discoverContactForBatch(deps, 1), ContactDiscoveryUnavailableError);
});
