import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GhlContactAssociationConflictError,
  finalizeStagedImport,
  type StagedFinalizeBatch,
  type StagedFinalizeDeps,
  type StagedFinalizeTx,
  type OpportunityValidation,
} from "../lib/imports/staged-finalization";
import { computeReviewSignature } from "../lib/imports/new-customer-review-server";
import {
  computeApprovalSignature,
  resolveBatchLocalIdentity,
  type GhlReviewSnapshot,
} from "../lib/imports/ghl-contact-approval";
import { createPrismaStagedFinalizeDeps } from "../lib/imports/staged-finalization-store";
import type { PlannableSummary } from "../lib/imports/finalizationPlan";

interface Summary extends PlannableSummary {
  importBatchId: number;
}

interface ClubRow {
  id: number;
  sessionId: number;
  clubType: string;
  clubRole: string;
  pairIndex: number;
  currentClubTestId: number | null;
  summaryId: number;
}

function makeBatch(over: Partial<StagedFinalizeBatch> = {}): StagedFinalizeBatch {
  const batch: StagedFinalizeBatch = {
    id: 1,
    parserMode: "trackman-result",
    status: "reviewing",
    demoSessionId: null,
    customerResolution: "existing",
    selectedGolfClientId: 10,
    proposedFirstName: null,
    proposedLastName: null,
    proposedEmail: null,
    proposedPhone: null,
    newCustomerConfirmationSignature: null,
    ghlContactDecision: null,
    approvedGhlContactId: null,
    ghlContactApprovalSignature: null,
    ghlContactApprovedAt: null,
    ghlContactApprovedByStaffUserId: null,
    ghlContactReviewSnapshot: null,
    opportunityResolution: "existing",
    selectedGhlOpportunityId: "opp-1",
    trackmanSessionDate: new Date("2026-05-08T12:00:00Z"),
    selectedGolfClient: {
      id: 10,
      ghlContactId: "contact-1",
      firstName: "Ann",
      lastName: "Lee",
      email: "ann@example.com",
      phone: "+12105550100",
    },
    demoSession: null,
    ...over,
  };
  const approvalKeys = [
    "ghlContactDecision",
    "approvedGhlContactId",
    "ghlContactApprovalSignature",
    "ghlContactReviewSnapshot",
  ] as const;
  if (approvalKeys.some((key) => key in over)) return batch;
  return resolveBatchLocalIdentity(batch, batch.selectedGolfClient)
    ? approveBatch(batch, "existing", "contact-1")
    : batch;
}

function approveBatch(
  batch: StagedFinalizeBatch,
  decision: "existing" | "new",
  contactId: string | null,
  snapshot: GhlReviewSnapshot = {
    v: 1,
    discoverySignature: "a".repeat(64),
    incomplete: false,
    candidates: [],
    acknowledgedDiscrepancies: [],
    acknowledgedCandidateIds: [],
  },
): StagedFinalizeBatch {
  const identity = resolveBatchLocalIdentity(batch, batch.selectedGolfClient);
  assert.ok(identity);
  return {
    ...batch,
    ghlContactDecision: decision,
    approvedGhlContactId: contactId,
    ghlContactApprovalSignature: computeApprovalSignature({
      identity,
      decision,
      approvedContactId: contactId,
      snapshot,
    }),
    ghlContactApprovedAt: new Date("2026-05-08T12:00:00Z"),
    ghlContactApprovedByStaffUserId: 7,
    ghlContactReviewSnapshot: snapshot,
  };
}

function summary(id: number, over: Partial<Summary> = {}): Summary {
  return {
    id,
    importBatchId: 1,
    clubName: `Club ${id}`,
    tags: [],
    includeInReport: true,
    currentSummaryId: null,
    ...over,
  };
}

interface Harness {
  deps: StagedFinalizeDeps<Summary>;
  state: {
    batch: StagedFinalizeBatch;
    summaries: Summary[];
    clients: {
      id: number;
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      phone: string | null;
    }[];
    clientLinks: { id: number; ghlContactId: string | null }[];
    sessions: { id: number; clientId: number; demoDate: Date; salesRep: string | null; ghlOpportunityId: string | null; status: string }[];
    clubs: ClubRow[];
    metrics: number[];
  };
  opts: {
    validation: OpportunityValidation | "throw";
    failAfterSession: boolean;
    ghlCalls: number;
    locked: boolean;
    validatedContacts: string[];
  };
}

interface SharedFinalizeCoordination {
  clients: Harness["state"]["clients"];
  acquireCustomerCreationLock(): Promise<() => void>;
}

function createSharedFinalizeCoordination(): SharedFinalizeCoordination {
  let tail: Promise<void> = Promise.resolve();
  return {
    clients: [],
    async acquireCustomerCreationLock() {
      let release!: () => void;
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      const previous = tail;
      tail = current;
      await previous;
      return release;
    },
  };
}

function harness(
  batch: StagedFinalizeBatch,
  summaries: Summary[],
  validation: OpportunityValidation | "throw" = { valid: true },
  shared?: SharedFinalizeCoordination,
): Harness {
  const state: Harness["state"] = {
    batch,
    summaries,
    clients: shared?.clients ?? [],
    clientLinks: batch.selectedGolfClient
      ? [{ id: batch.selectedGolfClient.id, ghlContactId: batch.selectedGolfClient.ghlContactId }]
      : [],
    sessions: [],
    clubs: [],
    metrics: [],
  };
  const opts: Harness["opts"] = {
    validation,
    failAfterSession: false,
    ghlCalls: 0,
    locked: false,
    validatedContacts: [],
  };
  let nextId = 100;
  let queue: Promise<unknown> = Promise.resolve();

  const attach = () =>
    state.sessions.length === 0
      ? null
      : state.sessions[state.sessions.length - 1]!;
  void attach;

  const reload = (): StagedFinalizeBatch => {
    const b = state.batch;
    const session = state.sessions.find((s) => s.id === b.demoSessionId) ?? null;
    return { ...b, demoSession: session && { id: session.id, status: session.status, clientId: session.clientId, ghlOpportunityId: session.ghlOpportunityId } };
  };

  const deps: StagedFinalizeDeps<Summary> = {
    loadBatch: async () => reload(),
    loadSummaries: async () => state.summaries,
    validateOpportunity: async (_opportunityId, ghlContactId) => {
      opts.ghlCalls++;
      opts.validatedContacts.push(ghlContactId);
      if (opts.validation === "throw") throw new Error("GHL down");
      return opts.validation;
    },
    now: () => new Date("2030-01-01T00:00:00Z"),
    // Serialized transactions with rollback on throw, like a row lock would give.
    transaction: <T,>(fn: (tx: StagedFinalizeTx<Summary>) => Promise<T>) => {
      const run = async (): Promise<T> => {
        const snapshot = structuredClone({
          batch: state.batch,
          clients: state.clients,
          clientLinks: state.clientLinks,
          sessions: state.sessions,
          clubs: state.clubs,
          metrics: state.metrics,
        });
        const customerCreationLock = {
          release: undefined as (() => void) | undefined,
        };
        const tx: StagedFinalizeTx<Summary> = {
          lockBatch: async () => {
            opts.locked = true;
          },
          lockNewCustomerCreation: async () => {
            customerCreationLock.release =
              await shared?.acquireCustomerCreationLock();
          },
          loadBatch: async () => reload(),
          loadSummaries: async () => state.summaries,
          listClientsForDuplicateCheck: async () => state.clients.map((c) => ({ ...c })),
          createClient: async (d) => {
            const c = {
              id: nextId++,
              firstName: d.firstName,
              lastName: d.lastName,
              email: d.email,
              phone: d.phone,
            };
            state.clients.push(c);
            state.clientLinks.push({ id: c.id, ghlContactId: null });
            return { id: c.id };
          },
          associateClientWithGhlContact: async (clientId, ghlContactId) => {
            const owner = state.clientLinks.find((link) => link.ghlContactId === ghlContactId);
            const client = state.clientLinks.find((link) => link.id === clientId);
            if (
              (owner && owner.id !== clientId) ||
              !client ||
              (client.ghlContactId && client.ghlContactId !== ghlContactId)
            ) {
              throw new GhlContactAssociationConflictError();
            }
            client.ghlContactId = ghlContactId;
          },
          createFinalizedSession: async (d) => {
            await Promise.resolve();
            const s = { id: nextId++, status: "finalized", ...d };
            state.sessions.push(s);
            return { id: s.id };
          },
          markBatchFinalized: async (_b, sessionId) => {
            if (opts.failAfterSession) throw new Error("db failure");
            state.batch = { ...state.batch, demoSessionId: sessionId, status: "finalized" };
          },
          clubStore: {
            listClubs: async () => [],
            deleteMetrics: async () => {},
            deleteClubs: async () => {},
            createClub: async (sessionId, row, currentClubTestId) => {
              const id = nextId++;
              state.clubs.push({
                id,
                sessionId,
                clubType: row.clubType,
                clubRole: row.clubRole,
                pairIndex: row.pairIndex,
                currentClubTestId,
                summaryId: row.summary.id,
              });
              return id;
            },
            createMetrics: async (clubId) => {
              state.metrics.push(clubId);
            },
          },
        };
        try {
          return await fn(tx);
        } catch (e) {
          state.batch = snapshot.batch;
          state.clients = snapshot.clients;
          state.clientLinks = snapshot.clientLinks;
          state.sessions = snapshot.sessions;
          state.clubs = snapshot.clubs;
          state.metrics = snapshot.metrics;
          throw e;
        } finally {
          customerCreationLock.release?.();
        }
      };
      const result = queue.then(run, run);
      queue = result.catch(() => undefined);
      return result;
    },
  };
  return { deps, state, opts };
}

const input = { batchId: 1, salesRep: "Rep" };

test("existing customer + existing opportunity", async () => {
  const h = harness(makeBatch(), [summary(1), summary(2)]);
  const r = await finalizeStagedImport(h.deps, input);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.alreadyFinalized, false);
  assert.equal(r.golfClientId, 10);
  assert.equal(r.clubCount, 2);
  assert.equal(h.state.clients.length, 0);
  const s = h.state.sessions[0]!;
  assert.equal(s.ghlOpportunityId, "opp-1");
  assert.equal(s.salesRep, "Rep");
  assert.equal(s.demoDate.toISOString(), "2026-05-08T12:00:00.000Z");
  assert.equal(h.state.batch.status, "finalized");
  assert.equal(h.state.batch.demoSessionId, s.id);
  assert.equal(h.opts.ghlCalls, 1);
});

test("existing customer + new opportunity leaves ghlOpportunityId null, no GHL call", async () => {
  const h = harness(
    makeBatch({ opportunityResolution: "new", selectedGhlOpportunityId: null }),
    [summary(1)],
  );
  const r = await finalizeStagedImport(h.deps, input);
  assert.equal(r.ok, true);
  assert.equal(h.state.sessions[0]!.ghlOpportunityId, null);
  assert.equal(h.opts.ghlCalls, 0);
});

test("existing customer without ghlContactId + new opportunity is valid", async () => {
  const h = harness(
    makeBatch({
      opportunityResolution: "new",
      selectedGhlOpportunityId: null,
      selectedGolfClient: {
        id: 10,
        ghlContactId: null,
        firstName: "Ann",
        lastName: "Lee",
        email: "ann@example.com",
        phone: "+12105550100",
      },
    }),
    [summary(1)],
  );
  const r = await finalizeStagedImport(h.deps, input);
  assert.equal(r.ok, true);
});

test("existing opportunity validates against the approved contact, not the saved client field", async () => {
  const h = harness(
    makeBatch({
      selectedGolfClient: {
        id: 10,
        ghlContactId: null,
        firstName: "Ann",
        lastName: "Lee",
        email: "ann@example.com",
        phone: "+12105550100",
      },
    }),
    [summary(1)],
  );
  const r = await finalizeStagedImport(h.deps, input);
  assert.equal(r.ok, true);
  assert.deepEqual(h.opts.validatedContacts, ["contact-1"]);
  assert.equal(h.state.clientLinks[0]!.ghlContactId, "contact-1");
});

test("an existing opportunity owned by a different GHL contact blocks finalization", async () => {
  const h = harness(
    makeBatch({
      opportunityResolution: "existing",
      selectedGhlOpportunityId: "opp-owned-by-other-contact",
      selectedGolfClient: {
        id: 10,
        ghlContactId: null,
        firstName: "Ann",
        lastName: "Lee",
        email: "ann@example.com",
        phone: "+12105550100",
      },
    }),
    [summary(1)],
    { valid: false, reason: "not_relevant" },
  );
  const r = await finalizeStagedImport(h.deps, input);
  assert.equal(r.ok === false && r.code, "opportunity_no_longer_valid");
  assert.deepEqual(h.opts.validatedContacts, ["contact-1"]);
  assert.equal(h.state.sessions.length, 0);
  assert.equal(h.state.clientLinks[0]!.ghlContactId, null);
});

function newCustomerBatch(over: Partial<StagedFinalizeBatch> = {}) {
  const batch = makeBatch({
    customerResolution: "new",
    selectedGolfClientId: null,
    selectedGolfClient: null,
    proposedFirstName: "Ann",
    proposedLastName: "Lee",
    proposedEmail: "ann@example.com",
    proposedPhone: "+12105550100",
    opportunityResolution: "new",
    selectedGhlOpportunityId: null,
    ...over,
  });
  return approveBatch(batch, "new", null);
}

const existingClient = (id: number, email: string | null, phone: string | null) => ({
  id,
  firstName: "Other",
  lastName: "Person",
  email,
  phone,
});

test("new customer with an unresolved email duplicate is rejected without creating", async () => {
  const h = harness(newCustomerBatch(), [summary(1)]);
  h.state.clients.push(existingClient(7, "ANN@example.com ", null));
  const r = await finalizeStagedImport(h.deps, input);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.code, "duplicate_customer_unresolved");
    assert.equal(r.status, 409);
  }
  assert.equal(h.state.clients.length, 1);
  assert.equal(h.state.sessions.length, 0);
});

test("legacy-formatted phone duplicate is detected at finalization", async () => {
  const h = harness(newCustomerBatch({ proposedEmail: null }), [summary(1)]);
  h.state.clients.push(existingClient(7, null, "(210) 555-0100"));
  const r = await finalizeStagedImport(h.deps, input);
  assert.equal(r.ok === false && r.code, "duplicate_customer_unresolved");
});

test("valid confirmation lets finalization create a different person", async () => {
  const sig = computeReviewSignature(
    { email: "ann@example.com", phone: "+12105550100" },
    [{ ...existingClient(7, null, "210-555-0100"), matchedOn: "phone" }],
  );
  const h = harness(
    newCustomerBatch({ newCustomerConfirmationSignature: sig }),
    [summary(1)],
  );
  h.state.clients.push(existingClient(7, null, "210-555-0100"));
  const r = await finalizeStagedImport(h.deps, input);
  assert.equal(r.ok, true);
  assert.equal(h.state.clients.length, 2);
  assert.equal(h.state.sessions.length, 1);
});

test("confirmation is rejected when a new match appeared after review", async () => {
  const sig = computeReviewSignature(
    { email: "ann@example.com", phone: "+12105550100" },
    [{ ...existingClient(7, null, "210-555-0100"), matchedOn: "phone" }],
  );
  const h = harness(
    newCustomerBatch({ newCustomerConfirmationSignature: sig }),
    [summary(1)],
  );
  h.state.clients.push(existingClient(7, null, "210-555-0100"));
  h.state.clients.push(existingClient(8, "ann@example.com", null));
  const r = await finalizeStagedImport(h.deps, input);
  assert.equal(r.ok === false && r.code, "duplicate_customer_unresolved");
  assert.equal(h.state.clients.length, 2);
});

test("stale confirmation is rejected after the match disappears and returns", async () => {
  const h = harness(
    newCustomerBatch({ newCustomerConfirmationSignature: "a".repeat(64) }),
    [summary(1)],
  );
  h.state.clients.push(existingClient(7, null, "210-555-0100"));
  const r = await finalizeStagedImport(h.deps, input);
  assert.equal(r.ok === false && r.code, "duplicate_customer_unresolved");
});

test("new customer with no duplicates is created, and a second identical batch conflicts", async () => {
  const batch = makeBatch({
    customerResolution: "new",
    selectedGolfClientId: null,
    selectedGolfClient: null,
    proposedFirstName: "Ann",
    proposedLastName: "Lee",
    proposedEmail: " Ann@Example.com ",
    proposedPhone: null,
    opportunityResolution: "new",
    selectedGhlOpportunityId: null,
  });
  const h = harness(batch, [summary(1)]);
  const r = await finalizeStagedImport(h.deps, input);
  assert.equal(r.ok, true);
  assert.equal(h.state.clients.length, 1);
  assert.equal(h.state.clients[0]!.email, "ann@example.com");

  // Another batch with the same email is never silently merged.
  h.state.batch = { ...batch, demoSessionId: null, status: "reviewing" };
  const r2 = await finalizeStagedImport(h.deps, input);
  assert.equal(r2.ok === false && r2.code, "duplicate_customer_unresolved");
  assert.equal(h.state.clients.length, 1);
});

test("concurrent finalizations of different batches serialize customer duplicate review and creation", async () => {
  const shared = createSharedFinalizeCoordination();
  const firstBatch = newCustomerBatch({ id: 21 });
  const secondBatch = newCustomerBatch({ id: 22 });
  const first = harness(firstBatch, [summary(1)], { valid: true }, shared);
  const second = harness(secondBatch, [summary(2)], { valid: true }, shared);

  const results = await Promise.all([
    finalizeStagedImport(first.deps, { batchId: 21, salesRep: "Rep" }),
    finalizeStagedImport(second.deps, { batchId: 22, salesRep: "Rep" }),
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(
    results.filter((result) => !result.ok && result.code === "duplicate_customer_unresolved").length,
    1,
  );
  assert.equal(shared.clients.length, 1);
  assert.equal(first.state.sessions.length + second.state.sessions.length, 1);
});

test("new customer + existing opportunity is rejected", async () => {
  const h = harness(
    makeBatch({
      customerResolution: "new",
      selectedGolfClientId: null,
      selectedGolfClient: null,
      proposedFirstName: "Max",
      proposedEmail: "a@b.co",
    }),
    [summary(1)],
  );
  const r = await finalizeStagedImport(h.deps, input);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "new_customer_existing_opportunity");
  assert.equal(h.state.sessions.length, 0);
});

test("unresolved customer and opportunity are rejected", async () => {
  const a = harness(
    makeBatch({ customerResolution: null, selectedGolfClientId: null, selectedGolfClient: null }),
    [summary(1)],
  );
  const ra = await finalizeStagedImport(a.deps, input);
  assert.equal(ra.ok === false && ra.code, "customer_unresolved");

  const b = harness(
    makeBatch({ opportunityResolution: null, selectedGhlOpportunityId: null }),
    [summary(1)],
  );
  const rb = await finalizeStagedImport(b.deps, input);
  assert.equal(rb.ok === false && rb.code, "opportunity_unresolved");
});

test("inconsistent opportunity state is rejected", async () => {
  const h = harness(
    makeBatch({ opportunityResolution: "new", selectedGhlOpportunityId: "opp-1" }),
    [summary(1)],
  );
  const r = await finalizeStagedImport(h.deps, input);
  assert.equal(r.ok === false && r.code, "invalid_opportunity_state");
});

test("no persistable clubs is rejected and leaves nothing behind", async () => {
  const h = harness(makeBatch(), [summary(1, { includeInReport: false })]);
  const r = await finalizeStagedImport(h.deps, input);
  assert.equal(r.ok === false && r.status, 400);
  assert.equal(h.state.sessions.length, 0);
  assert.equal(h.opts.locked, false);
});

test("comparison relationships are persisted", async () => {
  const h = harness(makeBatch(), [
    summary(1, { clubName: "Current 7i" }),
    summary(2, { clubName: "Test 7i", currentSummaryId: 1 }),
  ]);
  const r = await finalizeStagedImport(h.deps, input);
  assert.equal(r.ok, true);
  const current = h.state.clubs.find((c) => c.clubRole === "current")!;
  const demo = h.state.clubs.find((c) => c.clubRole === "demo")!;
  assert.equal(current.currentClubTestId, null);
  assert.equal(demo.currentClubTestId, current.id);
  assert.equal(current.pairIndex, demo.pairIndex);
  assert.equal(h.state.metrics.length, 2);
});

test("retry after success reuses the existing result", async () => {
  const h = harness(makeBatch(), [summary(1)]);
  const first = await finalizeStagedImport(h.deps, input);
  const second = await finalizeStagedImport(h.deps, input);
  assert.equal(first.ok && second.ok, true);
  if (first.ok && second.ok) {
    assert.equal(second.alreadyFinalized, true);
    assert.equal(second.demoSessionId, first.demoSessionId);
  }
  assert.equal(h.state.sessions.length, 1);
  assert.equal(h.state.clubs.length, 1);
});

test("concurrent submissions create exactly one session", async () => {
  const h = harness(makeBatch(), [summary(1), summary(2)]);
  const results = await Promise.all([
    finalizeStagedImport(h.deps, input),
    finalizeStagedImport(h.deps, input),
    finalizeStagedImport(h.deps, input),
  ]);
  assert.ok(results.every((r) => r.ok));
  assert.equal(h.state.sessions.length, 1);
  assert.equal(h.state.clubs.length, 2);
  assert.equal(results.filter((r) => r.ok && !r.alreadyFinalized).length, 1);
  const ids = new Set(results.map((r) => (r.ok ? r.demoSessionId : -1)));
  assert.equal(ids.size, 1);
});

test("a mid-transaction failure rolls back and a retry succeeds", async () => {
  const h = harness(makeBatch(), [summary(1)]);
  h.opts.failAfterSession = true;
  await assert.rejects(finalizeStagedImport(h.deps, input), /db failure/);
  assert.equal(h.state.sessions.length, 0);
  assert.equal(h.state.clubs.length, 0);
  assert.equal(h.state.batch.demoSessionId, null);
  assert.equal(h.state.batch.status, "reviewing");

  h.opts.failAfterSession = false;
  const r = await finalizeStagedImport(h.deps, input);
  assert.equal(r.ok, true);
  assert.equal(h.state.sessions.length, 1);
});

test("GHL outage is retryable; stale opportunity is a conflict", async () => {
  const down = harness(makeBatch(), [summary(1)], "throw");
  const r = await finalizeStagedImport(down.deps, input);
  assert.equal(r.ok === false && r.status, 502);
  assert.equal(r.ok === false && r.retryable, true);
  assert.equal(down.state.sessions.length, 0);

  const stale = harness(makeBatch(), [summary(1)], {
    valid: false,
    reason: "not_relevant",
  });
  const s = await finalizeStagedImport(stale.deps, input);
  assert.equal(s.ok === false && s.code, "opportunity_no_longer_valid");
});

test("current new-contact approval allows local finalization without a contact association", async () => {
  const h = harness(newCustomerBatch(), [summary(1)]);
  const r = await finalizeStagedImport(h.deps, input);
  assert.equal(r.ok, true);
  assert.equal(h.state.clients.length, 1);
  assert.equal(h.state.clientLinks[0]!.ghlContactId, null);
  assert.equal(h.opts.ghlCalls, 0);
});

test("a new local customer is linked to the approved existing GHL contact", async () => {
  const batch = approveBatch(newCustomerBatch(), "existing", "contact-1");
  const h = harness(batch, [summary(1)]);
  const r = await finalizeStagedImport(h.deps, input);
  assert.equal(r.ok, true);
  assert.equal(h.state.clients.length, 1);
  assert.equal(h.state.clientLinks[0]!.ghlContactId, "contact-1");
});

test("missing and stale GHL approvals block finalization before external checks or writes", async () => {
  const missing = makeBatch({
    ghlContactDecision: null,
    approvedGhlContactId: null,
    ghlContactApprovalSignature: null,
    ghlContactReviewSnapshot: null,
  });
  const stale = makeBatch();
  stale.ghlContactApprovalSignature = "0".repeat(64);

  for (const batch of [missing, stale]) {
    const h = harness(batch, [summary(1)]);
    const r = await finalizeStagedImport(h.deps, input);
    assert.equal(r.ok === false && r.code, "ghl_approval_required");
    assert.equal(h.opts.ghlCalls, 0);
    assert.equal(h.state.sessions.length, 0);
    assert.equal(h.state.clients.length, 0);
  }
});

test("a new-contact decision cannot be finalized with an existing opportunity", async () => {
  const h = harness(
    approveBatch(makeBatch(), "new", null),
    [summary(1)],
  );
  const r = await finalizeStagedImport(h.deps, input);
  assert.equal(r.ok === false && r.code, "new_contact_existing_opportunity");
  assert.equal(h.opts.ghlCalls, 0);
  assert.equal(h.state.sessions.length, 0);
});

test("a different saved GHL association blocks finalization", async () => {
  const h = harness(
    makeBatch({
      selectedGolfClient: {
        id: 10,
        ghlContactId: "contact-other",
        firstName: "Ann",
        lastName: "Lee",
        email: "ann@example.com",
        phone: "+12105550100",
      },
    }),
    [summary(1)],
  );
  const r = await finalizeStagedImport(h.deps, input);
  assert.equal(r.ok === false && r.code, "saved_contact_conflict");
  assert.equal(h.opts.ghlCalls, 0);
  assert.equal(h.state.sessions.length, 0);
});

test("a GHL contact linked to another local customer is not reassigned", async () => {
  const batch = approveBatch(
    makeBatch({
      opportunityResolution: "new",
      selectedGhlOpportunityId: null,
      selectedGolfClient: {
        id: 10,
        ghlContactId: null,
        firstName: "Ann",
        lastName: "Lee",
        email: "ann@example.com",
        phone: "+12105550100",
      },
    }),
    "existing",
    "contact-1",
  );
  const h = harness(batch, [summary(1)]);
  h.state.clientLinks.push({ id: 11, ghlContactId: "contact-1" });
  const r = await finalizeStagedImport(h.deps, input);
  assert.equal(r.ok === false && r.code, "ghl_contact_association_conflict");
  assert.equal(h.state.sessions.length, 0);
  assert.equal(h.state.clientLinks.find((link) => link.id === 11)!.ghlContactId, "contact-1");
});

test("legacy linked sessions remain idempotent without a current approval", async () => {
  const finalized = harness(
    makeBatch({
      demoSessionId: 5,
      demoSession: { id: 5, status: "finalized", clientId: 10, ghlOpportunityId: null },
      ghlContactDecision: null,
      approvedGhlContactId: null,
      ghlContactApprovalSignature: null,
      ghlContactReviewSnapshot: null,
    }),
    [summary(1)],
  );
  finalized.state.sessions.push({
    id: 5,
    status: "finalized",
    clientId: 10,
    ghlOpportunityId: null,
  } as never);
  const ok = await finalizeStagedImport(finalized.deps, input);
  assert.equal(ok.ok && ok.alreadyFinalized, true);
  assert.equal(finalized.opts.ghlCalls, 0);

  const draft = harness(
    makeBatch({
      demoSessionId: 5,
      demoSession: { id: 5, status: "draft", clientId: 10, ghlOpportunityId: null },
      ghlContactDecision: null,
      approvedGhlContactId: null,
      ghlContactApprovalSignature: null,
      ghlContactReviewSnapshot: null,
    }),
    [summary(1)],
  );
  const r = await finalizeStagedImport(draft.deps, input);
  assert.equal(r.ok === false && r.code, "already_linked");
});

test("the production finalization deps do not install the removed blanket guard", () => {
  const deps = createPrismaStagedFinalizeDeps({} as never);
  assert.equal("temporaryFinalizationGuard" in deps, false);
});

test("already-linked unfinalized session and missing batch are rejected", async () => {
  const legacy = harness(
    makeBatch({
      demoSessionId: 5,
      demoSession: { id: 5, status: "draft", clientId: 10, ghlOpportunityId: null },
    }),
    [summary(1)],
  );
  const r = await finalizeStagedImport(legacy.deps, input);
  assert.equal(r.ok === false && r.code, "already_linked");

  const missing = harness(makeBatch(), [summary(1)]);
  missing.deps.loadBatch = async () => null;
  const m = await finalizeStagedImport(missing.deps, input);
  assert.equal(m.ok === false && m.status, 404);
});

test("state changed between validation and lock is a retryable conflict", async () => {
  const h = harness(makeBatch(), [summary(1)]);
  const original = h.deps.validateOpportunity;
  h.deps.validateOpportunity = async (...args) => {
    const res = await original(...args);
    h.state.batch = { ...h.state.batch, selectedGhlOpportunityId: "opp-2" };
    return res;
  };
  const r = await finalizeStagedImport(h.deps, input);
  assert.equal(r.ok === false && r.code, "state_changed");
  assert.equal(h.state.sessions.length, 0);
});

test("approval changed between precheck and transaction blocks all finalization writes", async () => {
  const h = harness(makeBatch(), [summary(1)]);
  const validate = h.deps.validateOpportunity;
  h.deps.validateOpportunity = async (...args) => {
    const result = await validate(...args);
    const snapshot = h.state.batch.ghlContactReviewSnapshot as GhlReviewSnapshot;
    h.state.batch = approveBatch(
      {
        ...h.state.batch,
      },
      "existing",
      "contact-1",
      { ...snapshot, discoverySignature: "b".repeat(64) },
    );
    return result;
  };
  const r = await finalizeStagedImport(h.deps, input);
  assert.equal(r.ok === false && r.code, "state_changed");
  assert.equal(h.state.sessions.length, 0);
  assert.equal(h.state.clients.length, 0);
  assert.equal(h.state.clubs.length, 0);
});
