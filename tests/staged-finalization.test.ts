import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cp4dFinalizationGuard,
  finalizeStagedImport,
  type StagedFinalizeBatch,
  type StagedFinalizeDeps,
  type StagedFinalizeTx,
  type OpportunityValidation,
} from "../lib/imports/staged-finalization";
import { computeReviewSignature } from "../lib/imports/new-customer-review-server";
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
  return {
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
    opportunityResolution: "existing",
    selectedGhlOpportunityId: "opp-1",
    trackmanSessionDate: new Date("2026-05-08T12:00:00Z"),
    selectedGolfClient: { id: 10, ghlContactId: "contact-1" },
    demoSession: null,
    ...over,
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
    sessions: { id: number; clientId: number; demoDate: Date; salesRep: string | null; ghlOpportunityId: string | null; status: string }[];
    clubs: ClubRow[];
    metrics: number[];
  };
  opts: { validation: OpportunityValidation | "throw"; failAfterSession: boolean; ghlCalls: number; locked: boolean };
}

function harness(
  batch: StagedFinalizeBatch,
  summaries: Summary[],
  validation: OpportunityValidation | "throw" = { valid: true },
): Harness {
  const state: Harness["state"] = {
    batch,
    summaries,
    clients: [],
    sessions: [],
    clubs: [],
    metrics: [],
  };
  const opts: Harness["opts"] = { validation, failAfterSession: false, ghlCalls: 0, locked: false };
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
    validateOpportunity: async () => {
      opts.ghlCalls++;
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
          sessions: state.sessions,
          clubs: state.clubs,
          metrics: state.metrics,
        });
        const tx: StagedFinalizeTx<Summary> = {
          lockBatch: async () => {
            opts.locked = true;
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
            return { id: c.id };
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
          state.sessions = snapshot.sessions;
          state.clubs = snapshot.clubs;
          state.metrics = snapshot.metrics;
          throw e;
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
      selectedGolfClient: { id: 10, ghlContactId: null },
    }),
    [summary(1)],
  );
  const r = await finalizeStagedImport(h.deps, input);
  assert.equal(r.ok, true);
});

test("existing opportunity requires a ghlContactId", async () => {
  const h = harness(
    makeBatch({ selectedGolfClient: { id: 10, ghlContactId: null } }),
    [summary(1)],
  );
  const r = await finalizeStagedImport(h.deps, input);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "no_ghl_contact");
});

function newCustomerBatch(over: Partial<StagedFinalizeBatch> = {}) {
  return makeBatch({
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

// TEMPORARY (CP4c-A): remove with cp4dFinalizationGuard in CP4d.
test("temporary CP4d guard blocks staged finalization before any write", async () => {
  const h = harness(makeBatch(), [summary(1), summary(2)]);
  h.deps.temporaryFinalizationGuard = cp4dFinalizationGuard;
  const r = await finalizeStagedImport(h.deps, input);
  assert.equal(r.ok === false && r.code, "ghl_contact_integration_pending");
  assert.equal(r.ok === false && r.status, 409);
  assert.equal(h.state.sessions.length, 0);
  assert.equal(h.state.clubs.length, 0);
  assert.equal(h.opts.ghlCalls, 0);
});

test("temporary CP4d guard does not affect legacy already-linked sessions", async () => {
  const finalized = harness(
    makeBatch({
      demoSessionId: 5,
      demoSession: { id: 5, status: "finalized", clientId: 10, ghlOpportunityId: null },
    }),
    [summary(1)],
  );
  finalized.state.sessions.push({
    id: 5,
    status: "finalized",
    clientId: 10,
    ghlOpportunityId: null,
  } as never);
  finalized.deps.temporaryFinalizationGuard = cp4dFinalizationGuard;
  const ok = await finalizeStagedImport(finalized.deps, input);
  assert.equal(ok.ok && ok.alreadyFinalized, true);

  const draft = harness(
    makeBatch({
      demoSessionId: 5,
      demoSession: { id: 5, status: "draft", clientId: 10, ghlOpportunityId: null },
    }),
    [summary(1)],
  );
  draft.deps.temporaryFinalizationGuard = cp4dFinalizationGuard;
  const r = await finalizeStagedImport(draft.deps, input);
  assert.equal(r.ok === false && r.code, "already_linked");
});

test("the production finalization deps install the temporary guard", () => {
  const deps = createPrismaStagedFinalizeDeps({} as never);
  assert.equal(deps.temporaryFinalizationGuard, cp4dFinalizationGuard);
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
