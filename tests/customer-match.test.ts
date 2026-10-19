import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveCustomerMatches,
  type CustomerMatchCandidate,
} from "@/lib/queries/customer-match";

function candidate(overrides: Partial<CustomerMatchCandidate> = {}): CustomerMatchCandidate {
  return {
    id: 1,
    firstName: "Max",
    lastName: "Golfer",
    email: "max@example.com",
    phone: "+12105551234",
    ...overrides,
  };
}

test("normalized exact email match returns a single matched customer", () => {
  const result = resolveCustomerMatches([candidate()], "max@example.com");
  assert.deepEqual(result, { status: "matched", customer: candidate() });
});

test("case difference in email still matches", () => {
  const result = resolveCustomerMatches(
    [candidate({ email: "Max@Example.com" })],
    "max@example.com",
  );
  assert.equal(result.status, "matched");
});

test("surrounding whitespace in stored or TrackMan email still matches", () => {
  const result = resolveCustomerMatches(
    [candidate({ email: "  max@example.com  " })],
    "  max@example.com  ",
  );
  assert.equal(result.status, "matched");
});

test("zero matches when no candidate shares the email", () => {
  const result = resolveCustomerMatches(
    [candidate({ email: "someoneelse@example.com" })],
    "max@example.com",
  );
  assert.deepEqual(result, { status: "no-match" });
});

test("duplicate logical emails return an ambiguous result with all matches", () => {
  const first = candidate({ id: 1, email: "max@example.com" });
  const second = candidate({ id: 2, email: "MAX@EXAMPLE.COM" });
  const result = resolveCustomerMatches([first, second], "max@example.com");
  assert.equal(result.status, "ambiguous");
  if (result.status === "ambiguous") {
    assert.deepEqual(
      result.customers.map((c) => c.id).sort(),
      [1, 2],
    );
  }
});

test("missing TrackMan email returns no-email status without querying candidates", () => {
  const result = resolveCustomerMatches([candidate()], null);
  assert.deepEqual(result, { status: "no-email" });
});

test("blank TrackMan email also returns no-email status", () => {
  const result = resolveCustomerMatches([candidate()], "   ");
  assert.deepEqual(result, { status: "no-email" });
});

test("name-only similarity is never treated as a match", () => {
  const result = resolveCustomerMatches(
    [candidate({ firstName: "Max", lastName: "Golfer", email: "different@example.com" })],
    "max@example.com",
  );
  assert.deepEqual(result, { status: "no-match" });
});
