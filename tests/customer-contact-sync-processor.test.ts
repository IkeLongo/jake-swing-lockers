import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { GhlApiError, GhlDuplicateContactError } from "../lib/ghl/client";
import {
  processCustomerContactSync,
  type CustomerContactRecord,
  type CustomerContactSyncServices,
} from "../lib/ghl/customerContactSyncProcessor";
import {
  ContactDiscoveryUnavailableError,
  type ContactDiscovery,
  type DiscoveryApi,
  type DiscoveredContact,
} from "../lib/ghl/discoverStagedContacts";
import { matchGhlContact, type GhlContactMatchResult } from "../lib/ghl/matchGhlContact";
import type { ContactCreationAttempt } from "../lib/ghl/customerContactCreationCoordinator";
import type { CustomerSyncClaim } from "../lib/ghl/customerSyncWorkerState";
import { sameEmail, samePhone, type GhlContactLite } from "../lib/ghl/resolveStagedContact";

const originalFlag = process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED;
const LOCATION = "loc-1";
const CLAIM: CustomerSyncClaim = {
  golfClientId: 7,
  token: "11111111-1111-4111-8111-111111111111",
  version: 1,
};
const ATTEMPT: ContactCreationAttempt = {
  golfClientId: 7,
  id: "22222222-2222-4222-8222-222222222222",
  version: 1,
};

afterEach(() => {
  if (originalFlag === undefined) {
    delete process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED;
  } else {
    process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = originalFlag;
  }
});

function contact(id: string): GhlContactLite {
  return {
    id,
    locationId: LOCATION,
    firstName: "Ann",
    lastName: "Lee",
    email: "ann@example.com",
    phone: "+12105550100",
  };
}

function matched(id: string): GhlContactMatchResult {
  const found: DiscoveredContact = {
    ...contact(id),
    firstName: "Ann",
    lastName: "Lee",
    email: "ann@example.com",
    phone: "+12105550100",
    reasons: ["email", "phone"],
    discrepancies: [],
    wrongLocation: false,
    locationVerified: true,
    linkedClients: [],
  };
  const discovery: ContactDiscovery = {
    status: "single_match",
    searched: { email: true, phone: true },
    unsearchable: [],
    savedLink: { id: null, status: "none" },
    candidates: [found],
    flags: {
      multipleMatches: false,
      identifierConflict: false,
      identityConflict: false,
      wrongLocation: false,
      linkedElsewhere: false,
      incomplete: false,
      savedLinkMissing: false,
      savedLinkMismatch: false,
    },
  };
  return { status: "matched", contact: found, discovery };
}

function noMatch(): GhlContactMatchResult {
  const discovery: ContactDiscovery = {
    status: "no_match",
    searched: { email: true, phone: true },
    unsearchable: [],
    savedLink: { id: null, status: "none" },
    candidates: [],
    flags: {
      multipleMatches: false,
      identifierConflict: false,
      identityConflict: false,
      wrongLocation: false,
      linkedElsewhere: false,
      incomplete: false,
      savedLinkMissing: false,
      savedLinkMismatch: false,
    },
  };
  return { status: "no_match", discovery };
}

interface HarnessOptions {
  customer?: Partial<CustomerContactRecord>;
  match?: (
    customer: CustomerContactRecord,
    savedContactId: string | null,
    options?: { allowLinkedProfileDifferences?: boolean },
  ) => Promise<GhlContactMatchResult> | GhlContactMatchResult;
  createError?: Error;
  updateError?: Error;
  acknowledgeError?: Error;
  claimUnavailable?: boolean;
}

function harness(options: HarnessOptions = {}) {
  let customer: CustomerContactRecord = {
    id: 7,
    firstName: "Ann",
    lastName: "Lee",
    email: "ann@example.com",
    phone: "+12105550100",
    ghlContactId: null,
    syncState: {
      workStatus: "pending",
      desiredVersion: 1,
      syncedVersion: 0,
    },
    ...options.customer,
  };
  let claimed = false;
  const calls = {
    create: [] as Array<Record<string, string>>,
    update: [] as string[],
    link: [] as string[],
    reserve: 0,
    acknowledge: 0,
    reject: 0,
    uncertain: 0,
    complete: 0,
    failures: [] as Array<Parameters<CustomerContactSyncServices["fail"]>[1]>,
  };

  const services: CustomerContactSyncServices = {
    async claim() {
      if (customer.syncState?.workStatus === "needs_reconciliation") {
        return { status: "needs_reconciliation" };
      }
      if (
        options.claimUnavailable ||
        (claimed && customer.syncState?.workStatus !== "retryable_failed")
      ) {
        return { status: "unavailable" };
      }
      claimed = true;
      customer = {
        ...customer,
        syncState: customer.syncState
          ? { ...customer.syncState, workStatus: "processing" }
          : null,
      };
      return { status: "claimed", claim: CLAIM };
    },
    async loadCustomer() {
      return {
        ...customer,
        syncState: customer.syncState ? { ...customer.syncState } : null,
      };
    },
    async match(profile, savedContactId, matchOptions) {
      if (options.match) return options.match(profile, savedContactId, matchOptions);
      if (savedContactId) return matched(savedContactId);
      return noMatch();
    },
    async link(input) {
      calls.link.push(input.contactId);
      if (
        customer.syncState?.desiredVersion !== input.claim.version
      ) {
        return { status: "version_changed" };
      }
      customer.ghlContactId = input.contactId;
      return { status: "linked" };
    },
    async reserve() {
      calls.reserve += 1;
      if (customer.syncState?.desiredVersion !== CLAIM.version) {
        return { status: "blocked", reason: "version_changed" };
      }
      return { status: "reserved", attempt: ATTEMPT };
    },
    async createContact(input) {
      calls.create.push(input);
      if (options.createError) throw options.createError;
      return { id: "created" };
    },
    locationId: () => LOCATION,
    async acknowledge(_attempt, contactId) {
      calls.acknowledge += 1;
      if (options.acknowledgeError) throw options.acknowledgeError;
      customer.ghlContactId = contactId;
      return { status: "applied" };
    },
    async reject() {
      calls.reject += 1;
      return { status: "applied" };
    },
    async markUncertain() {
      calls.uncertain += 1;
      if (customer.syncState) {
        customer.syncState.workStatus = "needs_reconciliation";
      }
      return { status: "applied" };
    },
    async updateContact(contactId) {
      calls.update.push(contactId);
      if (options.updateError) throw options.updateError;
      return { id: contactId };
    },
    async complete() {
      calls.complete += 1;
      if (customer.syncState) {
        customer.syncState.workStatus =
          customer.syncState.desiredVersion > CLAIM.version ? "pending" : "synced";
        customer.syncState.syncedVersion = CLAIM.version;
      }
      return { status: "applied" };
    },
    async fail(_claim, failure) {
      calls.failures.push(failure);
      if (customer.syncState) {
        customer.syncState.workStatus =
          failure.kind === "retryable"
            ? "retryable_failed"
            : failure.kind === "review"
              ? "needs_review"
              : "needs_reconciliation";
      }
      if (failure.kind === "retryable") claimed = false;
      return { status: "applied" };
    },
  };
  return {
    services,
    calls,
    get customer() {
      return customer;
    },
    set customer(value: CustomerContactRecord) {
      customer = value;
    },
  };
}

function configureRealMatching(
  h: ReturnType<typeof harness>,
  contacts: GhlContactLite[],
) {
  const api: DiscoveryApi = {
    locationId: () => LOCATION,
    async getContact(id) {
      return contacts.find((item) => item.id === id) ?? null;
    },
    async lookupByEmail(email) {
      return {
        contacts: contacts.filter((item) => item.email && sameEmail(item.email, email)),
        hasMore: false,
      };
    },
    async lookupByPhone(phone) {
      return {
        contacts: contacts.filter((item) => item.phone && samePhone(item.phone, phone)),
        hasMore: false,
      };
    },
  };
  h.services.match = (customer, savedContactId, options) =>
    matchGhlContact(
      { api, findLinkedClients: async () => [] },
      { identity: customer, savedContactId, ownClientId: customer.id },
      options,
    );
}

test("disabled by default and does not claim customer work", async () => {
  delete process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED;
  const h = harness();
  let claimCount = 0;
  h.services.claim = async () => {
    claimCount += 1;
    return { status: "unavailable" };
  };

  assert.deepEqual(
    await processCustomerContactSync(7, h.services),
    { status: "disabled" },
  );
  assert.equal(claimCount, 0);
});

test("updates an existing verified linked contact without creating another", async () => {
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  const h = harness({ customer: { ghlContactId: "saved" } });

  const result = await processCustomerContactSync(7, h.services);

  assert.deepEqual(result, { status: "synced", contactId: "saved" });
  assert.deepEqual(h.calls.link, ["saved"]);
  assert.deepEqual(h.calls.update, ["saved"]);
  assert.equal(h.calls.create.length, 0);
  assert.equal(h.calls.complete, 1);
});

test("linked name, email, and US phone changes reach the saved contact update", async () => {
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  for (const change of [
    { firstName: "Anne" },
    { email: "new@example.com" },
    { phone: "(210) 555-0199" },
  ]) {
    const h = harness({ customer: { ghlContactId: "saved", ...change } });
    configureRealMatching(h, [contact("saved")]);
    let updatedProfile: CustomerContactRecord | undefined;
    const update = h.services.updateContact;
    h.services.updateContact = async (id, identity) => {
      updatedProfile = { ...h.customer, ...identity };
      return update(id, identity);
    };

    assert.deepEqual(await processCustomerContactSync(7, h.services), {
      status: "synced", contactId: "saved",
    });
    assert.deepEqual(h.calls.link, ["saved"]);
    assert.deepEqual(h.calls.update, ["saved"]);
    assert.equal(h.calls.create.length, 0);
    assert.ok(updatedProfile);
    for (const [field, value] of Object.entries(change)) {
      assert.equal(updatedProfile[field as keyof CustomerContactRecord], value);
    }
  }
});

test("a missing or competing saved contact stops the processor without writing", async () => {
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  for (const contacts of [
    [],
    [contact("saved"), { ...contact("other"), email: "new@example.com" }],
  ]) {
    const h = harness({
      customer: { ghlContactId: "saved", email: "new@example.com" },
    });
    configureRealMatching(h, contacts);
    assert.equal((await processCustomerContactSync(7, h.services)).status, "needs_review");
    assert.equal(h.calls.create.length, 0);
    assert.equal(h.calls.link.length, 0);
    assert.equal(h.calls.update.length, 0);
  }
});

test("links a unique existing contact before updating it", async () => {
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  const h = harness({
    match: async (_customer, savedContactId) =>
      savedContactId ? matched(savedContactId) : matched("existing"),
  });

  const result = await processCustomerContactSync(7, h.services);

  assert.deepEqual(result, { status: "synced", contactId: "existing" });
  assert.equal(h.customer.ghlContactId, "existing");
  assert.deepEqual(h.calls.link, ["existing"]);
  assert.deepEqual(h.calls.update, ["existing"]);
  assert.equal(h.calls.reserve, 0);
});

test("creates only after complete no-match, then verifies, acknowledges and updates", async () => {
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  const h = harness();

  const result = await processCustomerContactSync(7, h.services);

  assert.deepEqual(result, { status: "synced", contactId: "created" });
  assert.equal(h.calls.reserve, 1);
  assert.equal(h.calls.create.length, 1);
  assert.equal(h.calls.acknowledge, 1);
  assert.deepEqual(h.calls.link, ["created"]);
  assert.deepEqual(h.calls.update, ["created"]);
});

test("ambiguous matches require review and never create", async () => {
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  const h = harness({
    match: async () => ({
      status: "needs_review",
      reason: "discovery_requires_review",
    }),
  });

  assert.equal(
    (await processCustomerContactSync(7, h.services)).status,
    "needs_review",
  );
  assert.equal(h.calls.create.length, 0);
  assert.equal(h.calls.failures[0]?.kind, "review");
});

test("a contact already owned by another GolfClient is never linked or updated", async () => {
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  const h = harness({
    match: async () => ({
      status: "needs_review",
      reason: "discovery_requires_review",
    }),
  });

  assert.equal(
    (await processCustomerContactSync(7, h.services)).status,
    "needs_review",
  );
  assert.equal(h.calls.link.length, 0);
  assert.equal(h.calls.update.length, 0);
  assert.equal(h.calls.create.length, 0);
});

test("lookup failures use safe retry state and never create", async () => {
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  const h = harness({
    match: async () => {
      throw new ContactDiscoveryUnavailableError(new Error("GHL unavailable"));
    },
  });

  const result = await processCustomerContactSync(7, h.services);

  assert.equal(result.status, "retry_scheduled");
  assert.equal(h.calls.create.length, 0);
  assert.deepEqual(h.calls.failures[0], {
    kind: "retryable",
    retrySafety: "no_remote_write",
    delayMs: 60_000,
    code: "ghl_lookup_unavailable",
    message: "GHL contact lookup failed before any contact write; retry is safe.",
  });
});

test("uncertain contact creation remains for reconciliation and is not repeated", async () => {
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  const h = harness({ createError: new Error("network timeout") });

  assert.equal(
    (await processCustomerContactSync(7, h.services)).status,
    "needs_reconciliation",
  );
  assert.equal(
    (await processCustomerContactSync(7, h.services)).status,
    "needs_reconciliation",
  );
  assert.equal(h.calls.create.length, 1);
  assert.equal(h.calls.uncertain, 1);
});

test("definitive create rejection clears the attempt into staff review", async () => {
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  const h = harness({
    createError: new GhlApiError(429, "Too Many Requests", "rejected"),
  });

  assert.equal(
    (await processCustomerContactSync(7, h.services)).status,
    "needs_review",
  );
  assert.equal(h.calls.reject, 1);
  assert.equal(h.calls.uncertain, 0);
  assert.equal(h.calls.update.length, 0);
});

test("GHL duplicate rejection is reviewed without repeating the POST", async () => {
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  const h = harness({
    createError: new GhlDuplicateContactError("existing", "email"),
  });

  assert.equal(
    (await processCustomerContactSync(7, h.services)).status,
    "needs_review",
  );
  assert.equal(h.calls.create.length, 1);
  assert.equal(h.calls.reject, 1);
  assert.equal(h.calls.uncertain, 0);
});

test("unresolved creation attempts block processor claims", async () => {
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  const h = harness();
  h.services.claim = async () => ({ status: "needs_reconciliation" });

  assert.equal(
    (await processCustomerContactSync(7, h.services)).status,
    "needs_reconciliation",
  );
  assert.equal(h.calls.create.length, 0);
  assert.equal(h.calls.update.length, 0);
});

test("successful POST followed by failed local acknowledgement is reconciled", async () => {
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  const h = harness({ acknowledgeError: new Error("database unavailable") });

  assert.equal(
    (await processCustomerContactSync(7, h.services)).status,
    "needs_reconciliation",
  );
  assert.equal(h.calls.create.length, 1);
  assert.equal(h.calls.acknowledge, 1);
  assert.equal(h.calls.uncertain, 1);
  assert.equal(h.calls.update.length, 0);
});

test("idempotent contact update failures are retried on the next claim", async () => {
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  const h = harness({
    customer: { ghlContactId: "saved" },
  });
  let updateAttempts = 0;
  const updateContact = h.services.updateContact;
  h.services.updateContact = async (contactId, identity) => {
    updateAttempts += 1;
    if (updateAttempts === 1) {
      throw new GhlApiError(503, "Service Unavailable", "temporary");
    }
    return updateContact(contactId, identity);
  };

  const result = await processCustomerContactSync(7, h.services);
  assert.equal(result.status, "retry_scheduled");
  assert.deepEqual(
    await processCustomerContactSync(7, h.services),
    { status: "synced", contactId: "saved" },
  );

  assert.equal(updateAttempts, 2);
  assert.deepEqual(h.calls.failures[0], {
    kind: "retryable",
    retrySafety: "idempotent_update",
    delayMs: 60_000,
    code: "ghl_contact_update_retryable",
    message:
      "The same desired profile can be safely retried using an idempotent contact update: GHL API error: 503 Service Unavailable — temporary",
  });
});

test("a duplicate rejection during a profile update requires review", async () => {
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  const h = harness({
    customer: { ghlContactId: "saved" },
    updateError: new GhlDuplicateContactError("other", "email"),
  });
  assert.equal((await processCustomerContactSync(7, h.services)).status, "needs_review");
  assert.equal(h.calls.failures[0]?.kind, "review");
  assert.equal(h.calls.complete, 0);
});

test("concurrent worker and enabled legacy writer share one contact claim", async () => {
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  let releaseMatch!: () => void;
  let enteredMatch!: () => void;
  const entered = new Promise<void>((resolve) => {
    enteredMatch = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    releaseMatch = resolve;
  });
  const h = harness({
    match: async (_customer, savedContactId) => {
      if (!savedContactId) {
        enteredMatch();
        await gate;
        return noMatch();
      }
      return matched(savedContactId);
    },
  });

  const worker = processCustomerContactSync(7, h.services);
  await entered;
  const legacyWriter = processCustomerContactSync(7, h.services);
  assert.equal((await legacyWriter).status, "unavailable");
  releaseMatch();

  assert.deepEqual(await worker, { status: "synced", contactId: "created" });
  assert.equal(h.calls.create.length, 1);
  assert.equal(h.calls.update.length, 1);
});

test("profile changes during matching preserve the newer version without a stale write", async () => {
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  const h = harness({
    match: async () => matched("existing"),
  });
  const originalLink = h.services.link;
  h.services.link = async (input) => {
    h.customer = {
      ...h.customer,
      email: "new@example.com",
      syncState: {
        workStatus: "processing",
        desiredVersion: 2,
        syncedVersion: 0,
      },
    };
    return originalLink(input);
  };

  assert.equal(
    (await processCustomerContactSync(7, h.services)).status,
    "unavailable",
  );
  assert.equal(h.calls.update.length, 0);
  assert.equal(h.customer.syncState?.workStatus, "pending");
  assert.equal(h.customer.syncState?.desiredVersion, 2);
});

test("a profile changed during the contact update remains pending", async () => {
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  const h = harness({ customer: { ghlContactId: "saved", firstName: "Anne" } });
  configureRealMatching(h, [contact("saved")]);
  const update = h.services.updateContact;
  h.services.updateContact = async (id, identity) => {
    h.customer = {
      ...h.customer,
      firstName: "Anna",
      syncState: { workStatus: "processing", desiredVersion: 2, syncedVersion: 0 },
    };
    return update(id, identity);
  };

  assert.equal((await processCustomerContactSync(7, h.services)).status, "synced");
  assert.equal(h.customer.syncState?.workStatus, "pending");
  assert.equal(h.customer.syncState?.desiredVersion, 2);
  assert.equal(h.customer.syncState?.syncedVersion, 1);
});
