import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CUSTOMER_CONTACT_VERIFICATION_STATUSES,
  CUSTOMER_CREATION_ATTEMPT_STATUSES,
  CUSTOMER_SYNC_STATUSES,
} from "../lib/ghl/customerSyncState";

test("customer sync statuses match the persisted state contract", () => {
  assert.deepEqual(CUSTOMER_SYNC_STATUSES, [
    "pending",
    "processing",
    "synced",
    "retryable_failed",
    "needs_review",
    "needs_reconciliation",
  ]);
});

test("customer contact verification statuses are explicit", () => {
  assert.deepEqual(CUSTOMER_CONTACT_VERIFICATION_STATUSES, [
    "unverified",
    "verified",
    "needs_review",
  ]);
});

test("creation attempt statuses distinguish started from uncertain", () => {
  assert.deepEqual(CUSTOMER_CREATION_ATTEMPT_STATUSES, ["started", "unknown"]);
});
