import assert from "node:assert/strict";
import { test } from "node:test";
import {
  syncStagedFittingToGHL,
  type StagedSyncBatch,
  type StagedSyncDeps,
  type SyncOpportunityValidation,
} from "../lib/ghl/syncStagedFitting";
import {
  buildGolfDemoCustomFields,
  buildGolfDemoSummaries,
  golfDemoOpportunityName,
  type SyncSessionInfo,
} from "../lib/ghl/golfDemoSyncContent";
import { upsertGolfDemoOpportunity } from "../lib/ghl/opportunities";

// Field IDs are env-driven; configure one so the custom-field step runs.
process.env.GHL_SWINGLOCKER_CF_SWING_LOCKER_URL = "cf-url";

function makeBatch(over: Partial<StagedSyncBatch> = {}, sessionOver: Record<string, unknown> = {}): StagedSyncBatch {
  return {
    id: 1,
    parserMode: "trackman-result",
    status: "finalized",
    opportunityResolution: "new",
    selectedGhlOpportunityId: null,
    demoSession: {
      id: 7,
      status: "finalized",
      lockerToken: "tok",
      demoDate: new Date("2026-05-08T12:00:00Z"),
      salesRep: "Rep",
      currentClub: null,
      ghlOpportunityId: null,
      ghlSyncStatus: null,
      ghlLockerReadyTagAddedAt: null,
      clubTests: [
        { clubRole: "demo", clubType: "7i", brand: "Ping", model: "G430", isRecommended: false, estimatedPrice: { toNumber: () => 1000 } },
      ],
      client: { id: 3, firstName: "Ann", lastName: "Lee", email: "a@b.co", phone: null, ghlContactId: null },
      ...sessionOver,
    },
    ...over,
  } as StagedSyncBatch;
}

function cloneBatch(b: StagedSyncBatch): StagedSyncBatch {
  const s = b.demoSession;
  return {
    ...b,
    demoSession: s && {
      ...s,
      client: { ...s.client },
      clubTests: s.clubTests.map((c) => ({ ...c })),
    },
  };
}

interface Calls {
  contactCreates: number;
  createOpportunity: number;
  validate: number;
  fields: number;
  tags: number;
  order: string[];
  failedRetryable: boolean[];
}

function harness(batch: StagedSyncBatch) {
  const calls: Calls = { contactCreates: 0, createOpportunity: 0, validate: 0, fields: 0, tags: 0, order: [], failedRetryable: [] };
  const opts = {
    validation: { valid: true } as SyncOpportunityValidation | "throw",
    failAt: null as null | "fields" | "tags" | "create" | "contact",
  };
  const db = { batch, localWrites: 0 };
  const session = () => db.batch.demoSession!;
  let queue: Promise<unknown> = Promise.resolve();

  const deps: StagedSyncDeps = {
    loadBatch: async () => cloneBatch(db.batch),
    resolveContact: async (_input, saved) => {
      if (opts.failAt === "contact") throw new Error("contact down");
      if (saved) return { id: saved };
      calls.contactCreates++;
      return { id: "contact-new" };
    },
    saveContactId: async (_c, id) => {
      calls.order.push("saveContact");
      session().client.ghlContactId = id;
    },
    validateOpportunity: async () => {
      calls.validate++;
      if (opts.validation === "throw") throw new Error("GHL down");
      return opts.validation;
    },
    createOpportunity: async () => {
      calls.createOpportunity++;
      if (opts.failAt === "create") throw new Error("create failed");
      return `opp-${calls.createOpportunity}`;
    },
    ensureOpportunityId: (_id, create) => {
      const run = async () => {
        await Promise.resolve();
        if (session().ghlOpportunityId) return session().ghlOpportunityId!;
        const created = await create();
        calls.order.push("saveOpp");
        session().ghlOpportunityId = created;
        return created;
      };
      const r = queue.then(run, run);
      queue = r.catch(() => undefined);
      return r;
    },
    updateContactCustomFields: async () => {
      calls.fields++;
      calls.order.push("fields");
      if (opts.failAt === "fields") throw new Error("fields failed");
    },
    addTags: async () => {
      calls.tags++;
      if (opts.failAt === "tags") throw new Error("tags failed");
    },
    markTagsAdded: async () => {
      calls.order.push("tagMarker");
      session().ghlLockerReadyTagAddedAt = new Date();
    },
    markSynced: async () => {
      session().ghlSyncStatus = "synced";
    },
    markFailed: async (args) => {
      calls.failedRetryable.push(args.retryable);
      session().ghlSyncStatus = "failed";
    },
    now: () => new Date("2030-01-01T00:00:00Z"),
    appBaseUrl: () => "https://app.test",
  };
  return { deps, calls, opts, db };
}

test("new opportunity + customer without GHL contact", async () => {
  const h = harness(makeBatch());
  const r = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.ghlContactId, "contact-new");
  assert.equal(r.ghlOpportunityId, "opp-1");
  assert.equal(h.calls.contactCreates, 1);
  assert.equal(h.calls.createOpportunity, 1);
  assert.equal(h.db.batch.demoSession!.client.ghlContactId, "contact-new");
  assert.equal(h.db.batch.demoSession!.ghlSyncStatus, "synced");
});

test("existing ghlContactId is reused", async () => {
  const b = makeBatch();
  b.demoSession!.client.ghlContactId = "contact-old";
  const h = harness(b);
  const r = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(r.ok && r.ghlContactId, "contact-old");
  assert.equal(h.calls.contactCreates, 0);
});

test("contact and opportunity IDs are persisted before later steps", async () => {
  const h = harness(makeBatch());
  await syncStagedFittingToGHL(h.deps, 1);
  assert.deepEqual(h.calls.order, ["saveContact", "saveOpp", "fields", "tagMarker"]);
});

test("failure after opportunity creation keeps the ID; retry reuses it", async () => {
  const h = harness(makeBatch());
  h.opts.failAt = "fields";
  const first = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(first.ok, false);
  assert.equal(first.ok === false && first.status === "failed" && first.retryable, true);
  assert.equal(h.db.batch.demoSession!.ghlOpportunityId, "opp-1");
  assert.equal(h.db.batch.demoSession!.ghlSyncStatus, "failed");

  h.opts.failAt = null;
  const second = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(second.ok && second.ghlOpportunityId, "opp-1");
  assert.equal(h.calls.createOpportunity, 1);
  assert.equal(h.calls.contactCreates, 1);
});

test("a failed opportunity create is retryable and creates nothing locally", async () => {
  const h = harness(makeBatch());
  h.opts.failAt = "create";
  const r = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(r.ok === false && r.status, "failed");
  assert.equal(h.db.batch.demoSession!.ghlOpportunityId, null);
  h.opts.failAt = null;
  const again = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(again.ok, true);
});

test("existing opportunity: validated read-only, never created or updated", async () => {
  const b = makeBatch({ opportunityResolution: "existing", selectedGhlOpportunityId: "opp-x" }, { ghlOpportunityId: "opp-x" });
  b.demoSession!.client.ghlContactId = "contact-old";
  const h = harness(b);
  const r = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(r.ok && r.ghlOpportunityId, "opp-x");
  assert.equal(h.calls.validate, 1);
  assert.equal(h.calls.createOpportunity, 0);
  assert.equal(h.calls.fields, 1);
});

test("existing opportunity validation failures are recorded, not retryable", async () => {
  for (const reason of ["not_found", "not_relevant"] as const) {
    const b = makeBatch({ opportunityResolution: "existing", selectedGhlOpportunityId: "opp-x" }, { ghlOpportunityId: "opp-x" });
    const h = harness(b);
    h.opts.validation = { valid: false, reason };
    const r = await syncStagedFittingToGHL(h.deps, 1);
    assert.equal(r.ok === false && r.status === "failed" && r.retryable, false);
    assert.equal(h.db.batch.demoSession!.ghlSyncStatus, "failed");
    assert.equal(h.calls.tags, 0);
  }
});

test("existing opportunity GHL outage is retryable", async () => {
  const b = makeBatch({ opportunityResolution: "existing", selectedGhlOpportunityId: "opp-x" }, { ghlOpportunityId: "opp-x" });
  const h = harness(b);
  h.opts.validation = "throw";
  const r = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(r.ok === false && r.status === "failed" && r.retryable, true);
});

test("tags are not re-added after success; already-synced is a no-op", async () => {
  const h = harness(makeBatch());
  await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(h.calls.tags, 1);
  const again = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(again.ok && again.alreadySynced, true);
  assert.equal(h.calls.tags, 1);
  assert.equal(h.calls.fields, 1);
  assert.equal(h.calls.createOpportunity, 1);
});

test("tag failure leaves no marker; retry adds tags once without a new opportunity", async () => {
  const h = harness(makeBatch());
  h.opts.failAt = "tags";
  await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(h.db.batch.demoSession!.ghlLockerReadyTagAddedAt, null);
  h.opts.failAt = null;
  const r = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(r.ok, true);
  assert.equal(h.calls.createOpportunity, 1);
  assert.equal(h.calls.tags, 2);
});

test("tags already applied are not re-added when a later step is retried", async () => {
  const h = harness(makeBatch({}, { ghlLockerReadyTagAddedAt: new Date(), ghlSyncStatus: "failed", ghlOpportunityId: "opp-9" }));
  const r = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(r.ok && r.ghlOpportunityId, "opp-9");
  assert.equal(h.calls.tags, 0);
  assert.equal(h.calls.createOpportunity, 0);
});

test("a contact needing review fails the sync non-retryably without touching the fitting", async () => {
  const h = harness(makeBatch());
  const { ContactNeedsReviewError } = await import("../lib/ghl/resolveStagedContact");
  h.deps.resolveContact = async () => {
    throw new ContactNeedsReviewError("multiple_matches", "Multiple GHL contacts match.");
  };
  const r = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(r.ok, false);
  if (r.ok || r.status !== "failed") return assert.fail("expected failed");
  assert.equal(r.retryable, false);
  assert.equal(r.code, "contact-needs-review");
  assert.deepEqual(h.calls.failedRetryable, [false]);
  assert.equal(h.calls.createOpportunity, 0);
  assert.equal(h.db.batch.demoSession!.client.ghlContactId, null);
  assert.equal(h.db.batch.demoSession!.status, "finalized");
  assert.equal(h.db.batch.demoSession!.ghlSyncStatus, "failed");
});

test("preconditions are rejected", async () => {
  const cases: [StagedSyncBatch, string][] = [
    [makeBatch({ status: "reviewing" }), "not_finalized"],
    [makeBatch({ demoSession: null }), "no_session"],
    [makeBatch({ parserMode: "other" }), "not_eligible"],
    [makeBatch({ opportunityResolution: null }), "invalid_opportunity_state"],
    [makeBatch({ opportunityResolution: "new", selectedGhlOpportunityId: "opp-x" }), "invalid_opportunity_state"],
    [makeBatch({ opportunityResolution: "existing", selectedGhlOpportunityId: "opp-x" }), "invalid_opportunity_state"],
  ];
  for (const [batch, code] of cases) {
    const h = harness(batch);
    const r = await syncStagedFittingToGHL(h.deps, 1);
    assert.equal(r.ok === false && r.status === "rejected" && r.code, code);
    assert.equal(h.calls.contactCreates + h.calls.createOpportunity, 0);
  }
  const h = harness(makeBatch());
  h.deps.loadBatch = async () => null;
  const r = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(r.ok === false && r.status === "rejected" && r.httpStatus, 404);
});

test("simultaneous new-opportunity syncs create one opportunity", async () => {
  const h = harness(makeBatch());
  const results = await Promise.all([
    syncStagedFittingToGHL(h.deps, 1),
    syncStagedFittingToGHL(h.deps, 1),
    syncStagedFittingToGHL(h.deps, 1),
  ]);
  assert.ok(results.every((r) => r.ok));
  assert.equal(h.calls.createOpportunity, 1);
  assert.equal(new Set(results.map((r) => r.ok && r.ghlOpportunityId)).size, 1);
});

test("CRM failure leaves local fitting data untouched", async () => {
  const b = makeBatch();
  const before = cloneBatch(b).demoSession!;
  const h = harness(b);
  h.opts.failAt = "contact";
  const r = await syncStagedFittingToGHL(h.deps, 1);
  assert.equal(r.ok, false);
  const after = h.db.batch.demoSession!;
  assert.equal(h.db.batch.status, "finalized");
  assert.equal(after.status, "finalized");
  assert.deepEqual(after.clubTests, before.clubTests);
  assert.equal(after.ghlOpportunityId, null);
});

// ── Legacy preservation ─────────────────────────────────────────────────────

const session: SyncSessionInfo = {
  id: 7,
  demoDate: new Date("2026-05-08T12:00:00Z"),
  salesRep: "Rep",
  currentClub: "Old 7i",
  clubTests: [
    { clubRole: "demo", clubType: "7i", brand: "Ping", model: "G430", isRecommended: true, estimatedPrice: { toNumber: () => 199.999 } },
    { clubRole: "demo", clubType: "8i", brand: null, model: null, isRecommended: false, estimatedPrice: { toNumber: () => 100 } },
    { clubRole: "current", clubType: "7i", brand: null, model: null, isRecommended: false, estimatedPrice: null },
  ],
};

test("shared builders reproduce the legacy summary/field output", () => {
  const s = buildGolfDemoSummaries(session);
  assert.deepEqual(s, {
    recommendedClubSummary: "Ping G430",
    currentClubSummary: "7i",
    demoClubCount: 2,
    monetaryValue: 300,
  });
  const fields = buildGolfDemoCustomFields(session, s, "https://x/l", "T", {
    GHL_SWINGLOCKER_CF_SWING_LOCKER_URL: "f1",
    GHL_SWINGLOCKER_CF_LATEST_DEMO_DATE: "f2",
    GHL_SWINGLOCKER_CF_DEMO_FOLLOWUP_STATUS: "f3",
    GHL_SWINGLOCKER_CF_LAST_DEMO_SUBMITTED_AT: "f4",
  });
  assert.deepEqual(fields, [
    { id: "f1", value: "https://x/l" },
    { id: "f2", value: "2026-05-08" },
    { id: "f3", value: "pending" },
    { id: "f4", value: "T" },
  ]);
  assert.equal(golfDemoOpportunityName({ firstName: "Ann", lastName: null }), "Ann - Golf Demo");
  assert.equal(golfDemoOpportunityName({ firstName: null, lastName: null }), "- Golf Demo");
});

test("legacy upsertGolfDemoOpportunity still updates an existing ID and creates otherwise", async () => {
  Object.assign(process.env, {
    GHL_SWINGLOCKER_PRIVATE_TOKEN: "t",
    GHL_SWINGLOCKER_LOCATION_ID: "loc",
    GHL_SWINGLOCKER_PIPELINE_ID: "pipe",
    GHL_SWINGLOCKER_STAGE_DEMO_SUBMITTED_ID: "stage",
  });
  const original = globalThis.fetch;
  const requests: { url: string; method: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requests.push({ url, method: init?.method ?? "GET", body: JSON.parse((init?.body as string) ?? "{}") });
    return new Response(JSON.stringify({ opportunity: { id: "new-1" } }), { status: 200 });
  }) as typeof fetch;
  try {
    const id = await upsertGolfDemoOpportunity({ name: "N", contactId: "c", monetaryValue: 5 }, "opp-1");
    assert.equal(id, "opp-1");
    assert.equal(requests[0]!.method, "PUT");
    assert.deepEqual(requests[0]!.body, { name: "N", pipelineStageId: "stage", monetaryValue: 5 });

    const created = await upsertGolfDemoOpportunity({ name: "N", contactId: "c" }, null);
    assert.equal(created, "new-1");
    assert.equal(requests[1]!.method, "POST");
  } finally {
    globalThis.fetch = original;
  }
});
