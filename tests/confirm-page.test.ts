import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getConfirmClubs,
  getConfirmPageRedirect,
  getConfirmPageState,
  type ConfirmBatch,
  type ConfirmClubSummary,
} from "../lib/imports/confirm-page";
import {
  finalizeAndSync,
  runCrmSync,
  type FetchLike,
} from "../lib/imports/confirm-flow";
import { decodeSyncError, encodeSyncError, FITTING_RECONCILIATION_MESSAGE } from "../lib/ghl/syncErrorMarker";

function batch(over: Partial<ConfirmBatch> = {}): ConfirmBatch {
  return {
    id: 5,
    parserMode: "trackman-result",
    status: "reviewing",
    demoSessionId: null,
    customerResolution: "existing",
    selectedGolfClientId: 10,
    proposedFirstName: null,
    proposedLastName: null,
    proposedEmail: null,
    proposedPhone: null,
    opportunityResolution: "existing",
    selectedGhlOpportunityId: "opp-1",
    demoSession: null,
    ...over,
  };
}

function club(id: number, over: Partial<ConfirmClubSummary> = {}): ConfirmClubSummary {
  return {
    id,
    clubName: `Club ${id}`,
    tags: [],
    includeInReport: true,
    currentSummaryId: null,
    shotCount: 10 + id,
    ...over,
  };
}

// ── Redirect / state ─────────────────────────────────────────────────────────

test("eligible existing and new opportunity states render the page", () => {
  assert.equal(getConfirmPageRedirect(batch(), 2, "existing"), null);
  assert.equal(
    getConfirmPageRedirect(
      batch({ opportunityResolution: "new", selectedGhlOpportunityId: null }),
      2,
      "existing",
    ),
    null,
  );
  assert.equal(
    getConfirmPageRedirect(
      batch({ opportunityResolution: "new", selectedGhlOpportunityId: null }),
      2,
      "new",
    ),
    null,
  );
});

test("unresolved customer redirects to the customer step", () => {
  assert.equal(
    getConfirmPageRedirect(
      batch({ customerResolution: null, selectedGolfClientId: null }),
      2,
      null,
    ),
    "/staff/imports/5/customer",
  );
});

test("missing or stale GHL approval redirects to the customer step", () => {
  assert.equal(getConfirmPageRedirect(batch(), 2, null), "/staff/imports/5/customer");
});

test("an existing opportunity cannot be confirmed under a new-contact decision", () => {
  assert.equal(getConfirmPageRedirect(batch(), 2, "new"), "/staff/imports/5/opportunity");
});

test("unresolved or inconsistent opportunity redirects to the opportunity step", () => {
  for (const over of [
    { opportunityResolution: null, selectedGhlOpportunityId: null },
    { opportunityResolution: "existing", selectedGhlOpportunityId: null },
    { opportunityResolution: "new", selectedGhlOpportunityId: "opp-1" },
  ]) {
    assert.equal(
      getConfirmPageRedirect(batch(over), 2, "existing"),
      "/staff/imports/5/opportunity",
    );
  }
});

test("other ineligible batches are routed to an earlier step", () => {
  assert.equal(getConfirmPageRedirect(batch(), 0, "existing"), "/staff/imports/5/map");
  assert.equal(
    getConfirmPageRedirect(batch({ parserMode: "legacy" }), 2, null),
    "/staff/imports/5",
  );
  assert.equal(
    getConfirmPageRedirect(
      batch({ demoSessionId: 9, demoSession: { status: "draft", ghlSyncStatus: null } }),
      2,
      null,
    ),
    "/staff/imports/5/map",
  );
});

test("finalized batches stay on the page in every CRM state", () => {
  const finalized = (ghlSyncStatus: string | null, ghlSyncError: string | null = null) =>
    batch({
      status: "finalized",
      demoSessionId: 9,
      demoSession: { status: "finalized", ghlSyncStatus, ghlSyncError },
    });

  assert.equal(getConfirmPageRedirect(finalized(null), 2, null), null);
  assert.deepEqual(getConfirmPageState(batch()), { stage: "ready", syncAttempted: false, error: null });
  assert.deepEqual(getConfirmPageState(finalized(null)), { stage: "crm_pending", syncAttempted: false, error: null });
  assert.deepEqual(getConfirmPageState(finalized("failed", "GHL timeout")), {
    stage: "crm_pending",
    syncAttempted: true,
    error: "GHL timeout",
  });
  assert.deepEqual(getConfirmPageState(finalized("synced")), { stage: "synced", syncAttempted: true, error: null });
});

test("a persisted action-required failure stays non-retryable after refresh", () => {
  const stored = encodeSyncError("Multiple GHL contacts match.", false);
  const state = getConfirmPageState(
    batch({
      status: "finalized",
      demoSessionId: 9,
      demoSession: { status: "finalized", ghlSyncStatus: "failed", ghlSyncError: stored },
    }),
  );
  assert.deepEqual(state, {
    stage: "crm_action_required",
    syncAttempted: true,
    error: "Multiple GHL contacts match.",
  });
});

test("claims and unresolved creation markers require review after refresh, even if marked synced", () => {
  for (const ghlSyncState of [
    { version: 1, fittingClaim: { token: "interrupted" } },
    { version: 1, opportunity: { status: "creating" } },
    { version: 1, contact: { status: "creating" } },
  ]) {
    const state = getConfirmPageState(batch({
      status: "finalized", demoSessionId: 9,
      demoSession: { status: "finalized", ghlSyncStatus: "synced", ghlSyncState },
    }));
    assert.deepEqual(state, {
      stage: "crm_action_required", syncAttempted: true, error: FITTING_RECONCILIATION_MESSAGE,
    });
  }
  const customerAttempt = getConfirmPageState(batch({
    status: "finalized", demoSessionId: 9,
    demoSession: {
      status: "finalized", ghlSyncStatus: "failed",
      client: { syncState: { creationAttemptStatus: "unknown" } },
    },
  }));
  assert.equal(customerAttempt.stage, "crm_action_required");
});

test("sync error marker round-trips and plain errors stay retryable", () => {
  assert.deepEqual(decodeSyncError(encodeSyncError("x", true)), { message: "x", actionRequired: false });
  assert.deepEqual(decodeSyncError(encodeSyncError("x", false)), { message: "x", actionRequired: true });
  assert.deepEqual(decodeSyncError(null), { message: null, actionRequired: false });
});

// ── Clubs ────────────────────────────────────────────────────────────────────

test("included clubs list matches what finalization persists", () => {
  const clubs = getConfirmClubs([
    club(1, { clubName: "Driver", tags: ["Ping", "10.5"] }),
    club(2, { clubName: "7i", includeInReport: false }),
    club(3, { clubName: "7i", tags: ["G430"], currentSummaryId: 2 }),
    club(4, { clubName: "Hidden", includeInReport: false }),
  ]);
  assert.deepEqual(
    clubs.map((c) => [c.name, c.tags, c.shotCount, c.comparedWith]),
    [
      ["7i", ["G430"], 13, "7i"],
      ["Driver", ["Ping", "10.5"], 11, null],
    ],
  );
});

// ── Finalize → CRM sync sequence ─────────────────────────────────────────────

type Reply = { ok: boolean; status: number; body: unknown } | "throw";

function fakeFetch(replies: Record<string, Reply>) {
  const calls: string[] = [];
  const fn: FetchLike = async (url) => {
    calls.push(url);
    const reply = replies[url.replace(/^\/api\/staff\/imports\/\d+\//, "")];
    if (!reply || reply === "throw") throw new Error("network");
    return { ok: reply.ok, status: reply.status, json: async () => reply.body };
  };
  return { fn, calls };
}

const FINALIZE_OK: Reply = { ok: true, status: 200, body: { success: true } };
const SYNC_OK: Reply = { ok: true, status: 200, body: { success: true, status: "synced" } };

test("finalize then crm-sync, in order", async () => {
  const f = fakeFetch({ finalize: FINALIZE_OK, "crm-sync": SYNC_OK });
  const phase = await finalizeAndSync(f.fn, 5);
  assert.deepEqual(phase, { kind: "synced" });
  assert.deepEqual(f.calls, [
    "/api/staff/imports/5/finalize",
    "/api/staff/imports/5/crm-sync",
  ]);
});

test("local finalize failure never calls crm-sync", async () => {
  for (const finalize of [
    { ok: false, status: 409, body: { error: "Choose an opportunity", code: "opportunity_unresolved" } },
    { ok: false, status: 502, body: { error: "GHL down", retryable: true } },
    "throw",
  ] as Reply[]) {
    const f = fakeFetch({ finalize, "crm-sync": SYNC_OK });
    const phase = await finalizeAndSync(f.fn, 5);
    assert.equal(phase.kind, "finalize_failed");
    assert.deepEqual(f.calls, ["/api/staff/imports/5/finalize"]);
  }
});

test("CRM failure after local success is saved / pending, not a failed fitting", async () => {
  const f = fakeFetch({
    finalize: FINALIZE_OK,
    "crm-sync": {
      ok: false,
      status: 502,
      body: { success: false, status: "failed", retryable: true, error: "GHL timeout" },
    },
  });
  assert.deepEqual(await finalizeAndSync(f.fn, 5), {
    kind: "crm_pending",
    error: "GHL timeout",
  });

  const down = fakeFetch({ finalize: FINALIZE_OK, "crm-sync": "throw" });
  assert.equal((await finalizeAndSync(down.fn, 5)).kind, "crm_action_required");
});

test("retry calls only crm-sync", async () => {
  const f = fakeFetch({ finalize: FINALIZE_OK, "crm-sync": SYNC_OK });
  assert.deepEqual(await runCrmSync(f.fn, 5), { kind: "synced" });
  assert.deepEqual(f.calls, ["/api/staff/imports/5/crm-sync"]);
});

test("non-retryable CRM failure requires action instead of retry", async () => {
  const f = fakeFetch({
    finalize: FINALIZE_OK,
    "crm-sync": {
      ok: false,
      status: 502,
      body: {
        success: false,
        status: "failed",
        retryable: false,
        error: "The attached GHL opportunity no longer exists.",
      },
    },
  });
  assert.deepEqual(await finalizeAndSync(f.fn, 5), {
    kind: "crm_action_required",
    error: "The attached GHL opportunity no longer exists.",
  });
});

test("claim conflict response requires review even without a status field", async () => {
  const f = fakeFetch({
    "crm-sync": { ok: false, status: 409, body: { retryable: false, error: FITTING_RECONCILIATION_MESSAGE } },
  });
  assert.deepEqual(await runCrmSync(f.fn, 5), {
    kind: "crm_action_required", error: FITTING_RECONCILIATION_MESSAGE,
  });
});
test("an already-finalized retry that finalize reports as already finalized still syncs", async () => {
  const f = fakeFetch({
    finalize: { ok: true, status: 200, body: { success: true, alreadyFinalized: true } },
    "crm-sync": SYNC_OK,
  });
  assert.deepEqual(await finalizeAndSync(f.fn, 5), { kind: "synced" });
});
