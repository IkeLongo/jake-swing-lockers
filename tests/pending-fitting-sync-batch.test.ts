import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { runPendingFittingSyncBatch } from "../lib/ghl/runPendingFittingSyncBatch";
import { isFittingReadyForRecovery } from "../lib/ghl/runClaimedStagedFittingSync";
import type { StagedSyncBatch } from "../lib/ghl/syncStagedFitting";

const originalFlag = process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED;
const originalLocation = process.env.GHL_SWINGLOCKER_LOCATION_ID;
afterEach(() => {
  if (originalFlag === undefined) delete process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED;
  else process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = originalFlag;
  if (originalLocation === undefined) delete process.env.GHL_SWINGLOCKER_LOCATION_ID;
  else process.env.GHL_SWINGLOCKER_LOCATION_ID = originalLocation;
});

test("recovery requires a verified current contact and no review state", () => {
  process.env.GHL_SWINGLOCKER_LOCATION_ID = "location";
  const state = {
    desiredVersion: 1, syncedVersion: 1, workStatus: "synced",
    contactVerificationStatus: "verified", verifiedGhlLocationId: "location",
  };
  const batch = {
    parserMode: "trackman-result", status: "finalized",
    demoSession: {
      status: "finalized", ghlSyncStatus: "failed", ghlSyncError: "temporary",
      needsRefinalization: false,
      client: { ghlContactId: "contact", syncState: state },
    },
  } as StagedSyncBatch;
  assert.equal(isFittingReadyForRecovery(batch), true);
  state.syncedVersion = 0;
  assert.equal(isFittingReadyForRecovery(batch), false);
  state.syncedVersion = 1;
  state.verifiedGhlLocationId = "other";
  assert.equal(isFittingReadyForRecovery(batch), false);
  state.verifiedGhlLocationId = "location";
  batch.demoSession!.ghlSyncError = "[action-required] Review the outcome.";
  assert.equal(isFittingReadyForRecovery(batch), false);
  batch.demoSession!.ghlSyncError = null;
  batch.demoSession!.client.ghlContactCreationState = { status: "creating" };
  assert.equal(isFittingReadyForRecovery(batch), false);
});

test("disabled recovery performs no selection", async () => {
  delete process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED;
  const result = await runPendingFittingSyncBatch({ stopStartingAfterMs: 100 }, {
    async listCandidates() { throw new Error("must not select"); },
    async rotate() { throw new Error("must not rotate"); },
    async sync() { throw new Error("must not sync"); },
  });
  assert.equal(result.status, "disabled");
});

test("recovery distinguishes retryable failures from staff review", async () => {
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  for (const retryable of [true, false]) {
    const result = await runPendingFittingSyncBatch({ stopStartingAfterMs: 1000 }, {
      async listCandidates() { return [{ id: 1, updatedAt: new Date(), importBatches: [{ id: 1 }] }]; },
      async rotate() { return true; },
      async sync() {
        return { status: "result", result: {
          ok: false, status: "failed", demoSessionId: 1, retryable, error: "failure",
        } };
      },
    });
    assert.equal(result.retryable, retryable ? 1 : 0);
    assert.equal(result.needsReview, retryable ? 0 : 1);
  }
});

test("blocked and ambiguous candidates rotate; a later fitting runs", async () => {
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  const candidates = [
    { id: 1, updatedAt: new Date(1), importBatches: [{ id: 1 }] },
    { id: 2, updatedAt: new Date(2), importBatches: [{ id: 2 }, { id: 3 }] },
    { id: 3, updatedAt: new Date(3), importBatches: [{ id: 4 }] },
  ];
  const rotated: number[] = [];
  const calls: number[] = [];
  const result = await runPendingFittingSyncBatch({ stopStartingAfterMs: 1000 }, {
    async listCandidates() { return candidates; },
    async rotate(candidate) { rotated.push(candidate.id); return true; },
    async sync(_batchId, sessionId) {
      calls.push(sessionId);
      if (sessionId === 1) return { status: "blocked" };
      return { status: "result", result: {
        ok: true, status: "synced", alreadySynced: false,
        demoSessionId: sessionId, ghlContactId: "contact", ghlOpportunityId: "opportunity",
      } };
    },
  });
  assert.deepEqual(rotated, [1, 2, 3]);
  assert.deepEqual(calls, [1, 3]);
  assert.deepEqual(result, { status: "completed", scanned: 3, attempted: 1, succeeded: 1, retryable: 0, needsReview: 0, skipped: 2, errors: 0 });
});

test("recovery stops starting work at its deadline", async () => {
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  const now = Date.now;
  let time = 0;
  Date.now = () => time;
  try {
    const calls: number[] = [];
    let syncCalls = 0;
    const result = await runPendingFittingSyncBatch({ stopStartingAfterMs: 10 }, {
      async listCandidates() {
        return [1, 2].map((id) => ({ id, updatedAt: new Date(id), importBatches: [{ id }] }));
      },
      async rotate(candidate) { calls.push(candidate.id); time += 10; return true; },
      async sync() { syncCalls++; return { status: "blocked" }; },
    });

    assert.deepEqual(calls, [1]);
    assert.equal(result.scanned, 1);
    assert.equal(syncCalls, 0);
  } finally {
    Date.now = now;
  }
});

test("successive bounded scans reach work behind interrupted claims", async () => {
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  let order = 12;
  const candidates = Array.from({ length: 12 }, (_, index) => ({
    id: index + 1,
    updatedAt: new Date(index),
    importBatches: [{ id: index + 1 }],
  }));
  const deps = {
    async listCandidates() {
      return [...candidates].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime()).slice(0, 10)
        .map((candidate) => ({ ...candidate }));
    },
    async rotate(candidate: { id: number }) {
      candidates[candidate.id - 1].updatedAt = new Date(++order);
      return true;
    },
    async sync(_batchId: number, sessionId: number) {
      if (sessionId !== 12) return { status: "blocked" as const };
      return { status: "result" as const, result: {
        ok: true as const, status: "synced" as const, alreadySynced: false,
        demoSessionId: sessionId, ghlContactId: "contact", ghlOpportunityId: "opp",
      } };
    },
  };
  assert.equal((await runPendingFittingSyncBatch({ stopStartingAfterMs: 1000 }, deps)).succeeded, 0);
  const second = await runPendingFittingSyncBatch({ stopStartingAfterMs: 1000 }, deps);
  assert.equal(second.succeeded, 1);
  assert.equal(second.scanned, 2);
});
