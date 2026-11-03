import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyReview,
  findDuplicateCandidates,
  isReviewBlocking,
  type ClientIdentity,
} from "@/lib/imports/new-customer-review";
import {
  buildNewCustomerReview,
  computeReviewSignature,
  decideNewCustomerSave,
} from "@/lib/imports/new-customer-review-server";

const client = (
  id: number,
  email: string | null,
  phone: string | null,
): ClientIdentity => ({ id, firstName: "A", lastName: "B", email, phone });

const proposed = { email: "ann@example.com", phone: "+12105550100" };

test("no match yields no review", () => {
  const candidates = findDuplicateCandidates([client(1, "x@y.co", "+12105559999")], proposed);
  assert.equal(candidates.length, 0);
  assert.equal(classifyReview(candidates), "none");
});

test("email match is case/whitespace insensitive and exact_email", () => {
  const candidates = findDuplicateCandidates([client(1, " ANN@Example.com ", null)], proposed);
  assert.equal(candidates[0]?.matchedOn, "email");
  assert.equal(classifyReview(candidates), "exact_email");
});

test("legacy phone formats match as possible_phone", () => {
  for (const legacy of ["(210) 555-0100", "210.555.0100", "1-210-555-0100", "+1 210 555 0100"]) {
    const candidates = findDuplicateCandidates([client(1, null, legacy)], proposed);
    assert.equal(candidates[0]?.matchedOn, "phone", legacy);
    assert.equal(classifyReview(candidates), "possible_phone");
  }
});

test("short or empty stored phones never match", () => {
  assert.equal(findDuplicateCandidates([client(1, null, "555-0100")], { email: null, phone: "555-0100" }).length, 0);
});

test("email and phone on different clients is conflicting", () => {
  const candidates = findDuplicateCandidates(
    [client(1, "ann@example.com", null), client(2, null, "210-555-0100")],
    proposed,
  );
  assert.equal(candidates.length, 2);
  assert.equal(classifyReview(candidates), "conflicting");
});

test("same client matching both is a single email_and_phone candidate", () => {
  const candidates = findDuplicateCandidates(
    [client(1, "ann@example.com", "2105550100")],
    proposed,
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.matchedOn, "email_and_phone");
});

test("signature is stable, order independent, and sensitive to inputs", () => {
  const a = findDuplicateCandidates([client(1, "ann@example.com", null), client(2, null, "2105550100")], proposed);
  const sig = computeReviewSignature(proposed, a);
  assert.equal(sig, computeReviewSignature(proposed, [...a].reverse()));
  assert.notEqual(sig, computeReviewSignature({ ...proposed, email: "other@example.com" }, a));
  assert.notEqual(sig, computeReviewSignature(proposed, a.slice(0, 1)));
});

test("isReviewBlocking", () => {
  assert.equal(isReviewBlocking(null), false);
  assert.equal(isReviewBlocking({ kind: "none", confirmed: false }), false);
  assert.equal(isReviewBlocking({ kind: "exact_email", confirmed: false }), true);
  assert.equal(isReviewBlocking({ kind: "exact_email", confirmed: true }), false);
});

const clients = [client(1, null, "210-555-0100")];
const currentSig = buildNewCustomerReview(clients, proposed, null).signature;

test("duplicate without signature requires review and persists nothing", () => {
  const d = decideNewCustomerSave({
    clients,
    proposed,
    identityUnchanged: false,
    storedSignature: null,
    submittedSignature: null,
  });
  assert.equal(d.outcome, "review_required");
});

test("matching submitted signature sets a minimal-PII confirmation", () => {
  const d = decideNewCustomerSave({
    clients,
    proposed,
    identityUnchanged: false,
    storedSignature: null,
    submittedSignature: currentSig,
  });
  assert.equal(d.outcome, "save");
  if (d.outcome !== "save" || d.confirmation.action !== "set") return assert.fail();
  assert.equal(d.confirmation.signature, currentSig);
  assert.deepEqual(d.confirmation.snapshot.candidates, [{ id: 1, matchedOn: "phone" }]);
  assert.equal(JSON.stringify(d.confirmation.snapshot).includes("firstName"), false);
});

test("stale signature (candidate set changed) is review_changed", () => {
  const d = decideNewCustomerSave({
    clients: [...clients, client(2, "ann@example.com", null)],
    proposed,
    identityUnchanged: false,
    storedSignature: null,
    submittedSignature: currentSig,
  });
  assert.equal(d.outcome, "review_changed");
});

test("signature from a different proposed identity is rejected", () => {
  const d = decideNewCustomerSave({
    clients,
    proposed: { email: "new@example.com", phone: "+12105550100" },
    identityUnchanged: false,
    storedSignature: null,
    submittedSignature: currentSig,
  });
  assert.equal(d.outcome, "review_changed");
});

test("stored confirmation is kept only when identity unchanged and still current", () => {
  const base = { clients, proposed, storedSignature: currentSig, submittedSignature: null };
  const kept = decideNewCustomerSave({ ...base, identityUnchanged: true });
  assert.equal(kept.outcome === "save" && kept.confirmation.action, "keep");

  const changed = decideNewCustomerSave({ ...base, identityUnchanged: false });
  assert.equal(changed.outcome, "review_required");

  const stale = decideNewCustomerSave({
    ...base,
    clients: [...clients, client(3, null, "+12105550100")],
    identityUnchanged: true,
  });
  assert.equal(stale.outcome, "review_required");
});

test("no candidates clears any confirmation", () => {
  const d = decideNewCustomerSave({
    clients: [],
    proposed,
    identityUnchanged: true,
    storedSignature: currentSig,
    submittedSignature: null,
  });
  assert.equal(d.outcome === "save" && d.confirmation.action, "clear");
});

test("persisted review survives refresh (recomputed confirmed flag)", () => {
  assert.equal(buildNewCustomerReview(clients, proposed, currentSig).confirmed, true);
  assert.equal(buildNewCustomerReview(clients, proposed, "b".repeat(64)).confirmed, false);
  assert.equal(
    buildNewCustomerReview([...clients, client(9, "ann@example.com", null)], proposed, currentSig).confirmed,
    false,
  );
});
