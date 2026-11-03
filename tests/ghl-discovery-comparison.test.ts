import test from "node:test";
import assert from "node:assert/strict";
import {
  candidateIndicators,
  candidateNeedsReview,
  discoveryNotices,
} from "@/lib/ghl/discoveryComparison";
import type {
  ContactDiscovery,
  DiscoveredContact,
} from "@/lib/ghl/discoverStagedContacts";

const local = {
  firstName: "Ann",
  lastName: "Lee",
  email: "ann@example.com",
  phone: "+12105550100",
};

const candidate = (over: Partial<DiscoveredContact> = {}): DiscoveredContact => ({
  id: "c1",
  firstName: "Ann",
  lastName: "Lee",
  email: "ann@example.com",
  phone: "(210) 555-0100",
  reasons: ["email"],
  discrepancies: [],
  wrongLocation: false,
  locationVerified: true,
  linkedClients: [],
  ...over,
});

const discovery = (
  over: Partial<ContactDiscovery["flags"]> = {},
  status: ContactDiscovery["status"] = "single_match",
): ContactDiscovery => ({
  status,
  searched: { email: true, phone: true },
  unsearchable: [],
  savedLink: { id: null, status: "none" },
  candidates: [],
  flags: {
    multipleMatches: false,
    identifierConflict: false,
    identityConflict: false,
    wrongLocation: false,
    linkedElsewhere: false,
    incomplete: false,
    savedLinkMissing: false,
    savedLinkMismatch: false,
    ...over,
  },
});

test("matching identifiers get match indicators (formatting-insensitive)", () => {
  assert.deepEqual(candidateIndicators(local, candidate()), [
    { tone: "match", label: "Email matches" },
    { tone: "match", label: "Phone number matches" },
  ]);
});

test("phone match with a different email warns about the email", () => {
  const out = candidateIndicators(local, candidate({ email: "other@example.com" }));
  assert.deepEqual(out, [
    { tone: "warn", label: "Email addresses differ" },
    { tone: "match", label: "Phone number matches" },
  ]);
});

test("missing values are never a match and produce no indicator", () => {
  assert.deepEqual(candidateIndicators(local, candidate({ email: null, phone: null })), []);
  assert.deepEqual(
    candidateIndicators({ ...local, email: null, phone: " " }, candidate()),
    [],
  );
});

test("a wrong-location contact never shows a match indicator", () => {
  const out = candidateIndicators(local, candidate({ wrongLocation: true }));
  assert.deepEqual(out, [{ tone: "warn", label: "Belongs to a different GHL location" }]);
});

test("name discrepancies and linked customers warn", () => {
  const out = candidateIndicators(
    local,
    candidate({
      discrepancies: ["lastName"],
      linkedClients: [{ id: 42, name: "Zed Q" }],
    }),
  );
  assert.ok(out.some((i) => i.tone === "warn" && i.label === "Name differs"));
  assert.ok(out.some((i) => i.label === "Already linked to Zed Q (#42)"));
});

test("needs-review reflects candidate and global conditions", () => {
  assert.equal(candidateNeedsReview(discovery(), candidate()), false);
  assert.equal(candidateNeedsReview(discovery(), candidate({ wrongLocation: true })), true);
  assert.equal(candidateNeedsReview(discovery(), candidate({ discrepancies: ["phone"] })), true);
  assert.equal(
    candidateNeedsReview(discovery(), candidate({ linkedClients: [{ id: 1, name: "A" }] })),
    true,
  );
  for (const flag of ["multipleMatches", "identifierConflict", "incomplete", "savedLinkMismatch"] as const) {
    assert.equal(candidateNeedsReview(discovery({ [flag]: true }), candidate()), true, flag);
  }
});

test("notices cover global conditions only", () => {
  const d = discovery({ incomplete: true, savedLinkMissing: true, multipleMatches: true });
  d.unsearchable = ["phone"];
  assert.equal(discoveryNotices(d).length, 4);
  assert.deepEqual(discoveryNotices(discovery()), []);
});
