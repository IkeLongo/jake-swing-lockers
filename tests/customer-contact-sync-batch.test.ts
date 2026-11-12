import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  MAX_CUSTOMER_SYNC_BATCH_SIZE,
  runCustomerContactSyncBatch,
} from "../lib/ghl/runCustomerContactSyncBatch";
import type { CustomerContactSyncResult } from "../lib/ghl/customerContactSyncProcessor";

const originalFlag = process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED;

afterEach(() => {
  if (originalFlag === undefined) delete process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED;
  else process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = originalFlag;
});

test("disabled batch does not select or process customers", async () => {
  delete process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED;
  const result = await runCustomerContactSyncBatch(5, {
    async listCandidates() { throw new Error("must not select"); },
    async processCustomer() { throw new Error("must not process"); },
  });
  assert.equal(result.status, "disabled");
  assert.equal(result.summary.processed, 0);
});

test("batch size is validated, and an empty queue is handled", async () => {
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  for (const limit of [0, -1, 1.5, MAX_CUSTOMER_SYNC_BATCH_SIZE + 1, NaN]) {
    await assert.rejects(runCustomerContactSyncBatch(limit), RangeError);
  }
  const result = await runCustomerContactSyncBatch(undefined, {
    async listCandidates(limit) {
      assert.equal(limit, 5);
      return [];
    },
    async processCustomer() { throw new Error("must not process"); },
  });
  assert.deepEqual(result, {
    status: "completed",
    summary: {
      processed: 0, succeeded: 0, retryScheduled: 0, needsReview: 0,
      needsReconciliation: 0, skipped: 0, errors: 0,
    },
  });
});

test("batch reports only counts, continues after failure, and passes its bound", async () => {
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  const outcomes: CustomerContactSyncResult[] = [
    { status: "synced", contactId: "private-contact" },
    { status: "retry_scheduled", message: "private details" },
    { status: "needs_review", message: "private details" },
    { status: "needs_reconciliation" },
    { status: "unavailable" },
  ];
  const calls: number[] = [];
  const result = await runCustomerContactSyncBatch(6, {
    async listCandidates(limit) {
      assert.equal(limit, 6);
      return [1, 2, 3, 4, 5, 6];
    },
    async processCustomer(id) {
      calls.push(id);
      if (id === 2) throw new Error("private exception");
      return outcomes[id === 1 ? 0 : id - 2]!;
    },
  });
  assert.deepEqual(calls, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(result.summary, {
    processed: 6, succeeded: 1, retryScheduled: 1, needsReview: 1,
    needsReconciliation: 1, skipped: 1, errors: 1,
  });
  assert.doesNotMatch(JSON.stringify(result), /private/);
});

test("concurrent batches rely on the processor claim to prevent duplicate work", async () => {
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  let claimed = false;
  let writes = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const dependencies = {
    async listCandidates() { return [1]; },
    async processCustomer(): Promise<CustomerContactSyncResult> {
      if (claimed) return { status: "unavailable" };
      claimed = true;
      await gate;
      writes++;
      return { status: "synced", contactId: "private" };
    },
  };
  const first = runCustomerContactSyncBatch(1, dependencies);
  const second = runCustomerContactSyncBatch(1, dependencies);
  release();
  const results = await Promise.all([first, second]);
  assert.equal(writes, 1);
  assert.equal(results.reduce((sum, item) => sum + item.summary.succeeded, 0), 1);
  assert.equal(results.reduce((sum, item) => sum + item.summary.skipped, 0), 1);
});

test("batch stops when processing is disabled mid-run", async () => {
  process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED = "true";
  const result = await runCustomerContactSyncBatch(2, {
    async listCandidates() { return [1, 2]; },
    async processCustomer() {
      delete process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED;
      return { status: "synced", contactId: "private" };
    },
  });
  assert.equal(result.status, "disabled");
  assert.equal(result.summary.processed, 1);
  assert.equal(result.summary.succeeded, 1);
});
