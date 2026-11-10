import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getLegacyConfirmBlock } from "@/lib/imports/legacy-confirm-guard";

test("an unlinked staged TrackMan batch is rejected with staged_workflow_required", () => {
  const block = getLegacyConfirmBlock({ parserMode: "trackman-result", demoSessionId: null });
  assert.equal(block?.status, 409);
  assert.equal(block?.code, "staged_workflow_required");
});

test("non-staged legacy batches and already-linked batches are not blocked by the guard", () => {
  assert.equal(getLegacyConfirmBlock({ parserMode: "legacy-csv", demoSessionId: null }), null);
  assert.equal(getLegacyConfirmBlock({ parserMode: "trackman-result", demoSessionId: 5 }), null);
});

const source = readFileSync("app/api/staff/imports/[id]/confirm/route.ts", "utf8");

test("the route checks the persisted batch (not the request) before any write", () => {
  const guard = source.indexOf("getLegacyConfirmBlock(batch)");
  assert.ok(guard > 0, "route must call the guard with the loaded batch");
  assert.ok(source.indexOf("db.importBatch.findUnique") < guard);
  for (const write of [
    "createGolfClientIfUnique(db,",
    "db.demoSession.create",
    "db.importBatch.update",
  ]) {
    assert.ok(source.indexOf(write) > guard, `${write} must come after the guard`);
  }
  // The already-linked response is unchanged and still precedes the guard.
  assert.ok(source.indexOf("already been confirmed") < guard);
});
