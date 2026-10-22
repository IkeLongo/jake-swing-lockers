import test from "node:test";
import assert from "node:assert/strict";
import { groupFinalizedClubs } from "@/lib/comparison/groupFinalizedClubs";

const club = (name: string, clubRole: string, pairIndex: number) => ({
  name,
  clubRole,
  pairIndex,
});

test("pairIndex 0 is a valid group with its current club", () => {
  const groups = groupFinalizedClubs([
    club("test", "demo", 0),
    club("curr", "current", 0),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.pairIndex, 0);
  assert.equal(groups[0]!.current?.name, "curr");
  assert.deepEqual(groups[0]!.tests.map((t) => t.name), ["test"]);
});

test("standalone test has no current", () => {
  const groups = groupFinalizedClubs([club("solo", "demo", 3)]);
  assert.equal(groups[0]!.current, null);
  assert.deepEqual(groups[0]!.tests.map((t) => t.name), ["solo"]);
});

test("current without a test yields a group with empty tests", () => {
  const groups = groupFinalizedClubs([club("curr", "current", 1)]);
  assert.equal(groups[0]!.current?.name, "curr");
  assert.deepEqual(groups[0]!.tests, []);
});

test("multiple groups are sorted by pairIndex regardless of input order", () => {
  const groups = groupFinalizedClubs([
    club("t2", "demo", 2),
    club("c1", "current", 1),
    club("t0", "demo", 0),
    club("t1", "demo", 1),
    club("c2", "current", 2),
  ]);
  assert.deepEqual(groups.map((g) => g.pairIndex), [0, 1, 2]);
  assert.equal(groups[1]!.current?.name, "c1");
  assert.equal(groups[2]!.current?.name, "c2");
});

test("multiple tests sharing a pairIndex are all preserved in input order", () => {
  const groups = groupFinalizedClubs([
    club("a", "demo", 0),
    club("curr", "current", 0),
    club("b", "demo", 0),
    club("c", "demo", 0),
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]!.tests.map((t) => t.name), ["a", "b", "c"]);
});

test("duplicate currents: first in input order wins", () => {
  const groups = groupFinalizedClubs([
    club("c-first", "current", 0),
    club("c-second", "current", 0),
    club("t", "demo", 0),
  ]);
  assert.equal(groups[0]!.current?.name, "c-first");
  assert.equal(groups[0]!.tests.length, 1);
});

test("unknown roles are ignored and input is not mutated", () => {
  const input = [club("x", "baseline", 0), club("t", "demo", 0)];
  const snapshot = [...input];
  const groups = groupFinalizedClubs(input);
  assert.equal(groups[0]!.current, null);
  assert.deepEqual(groups[0]!.tests.map((t) => t.name), ["t"]);
  assert.deepEqual(input, snapshot);
});

test("empty input yields no groups", () => {
  assert.deepEqual(groupFinalizedClubs([]), []);
});

// ── currentClubTestId (explicit) representation ─────────────────────────────

const row = (
  id: number,
  clubRole: string,
  pairIndex: number,
  currentClubTestId: number | null = null,
) => ({ id, name: `n${id}`, clubRole, pairIndex, currentClubTestId });

test("explicit: many Tests point at one Current", () => {
  const groups = groupFinalizedClubs([
    row(100, "current", 0),
    row(101, "demo", 0, 100),
    row(102, "demo", 0, 100),
    row(103, "demo", 0, 100),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.current?.id, 100);
  assert.deepEqual(groups[0]!.tests.map((t) => t.id), [101, 102, 103]);
});

test("explicit: reference is authoritative even when pairIndex disagrees", () => {
  const groups = groupFinalizedClubs([
    row(100, "current", 0),
    row(101, "demo", 5, 100),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.current?.id, 100);
  assert.deepEqual(groups[0]!.tests.map((t) => t.id), [101]);
});

test("explicit: standalone Test and multiple groups, sorted by pairIndex", () => {
  const groups = groupFinalizedClubs([
    row(300, "demo", 2),
    row(200, "current", 1),
    row(201, "demo", 1, 200),
    row(100, "current", 0),
    row(101, "demo", 0, 100),
    row(102, "demo", 0, 100),
  ]);
  assert.deepEqual(groups.map((g) => g.pairIndex), [0, 1, 2]);
  assert.deepEqual(groups.map((g) => g.current?.id ?? null), [100, 200, null]);
  assert.deepEqual(groups[0]!.tests.map((t) => t.id), [101, 102]);
  assert.deepEqual(groups[2]!.tests.map((t) => t.id), [300]);
});

test("legacy rows (null reference) with pairIndex 0 still group", () => {
  const groups = groupFinalizedClubs([row(1, "current", 0), row(2, "demo", 0)]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.current?.id, 1);
  assert.deepEqual(groups[0]!.tests.map((t) => t.id), [2]);
});

test("malformed: Test referencing a missing Current is kept (legacy fallback)", () => {
  const groups = groupFinalizedClubs([row(2, "demo", 4, 999)]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.current, null);
  assert.deepEqual(groups[0]!.tests.map((t) => t.id), [2]);
});

test("malformed: orphan Test sharing pairIndex joins the explicit group, not lost", () => {
  const groups = groupFinalizedClubs([
    row(100, "current", 0),
    row(101, "demo", 0, 100),
    row(102, "demo", 0, 999),
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]!.tests.map((t) => t.id), [101, 102]);
});

test("malformed: reference to a non-Current row is not treated as a Current", () => {
  const groups = groupFinalizedClubs([row(1, "demo", 0), row(2, "demo", 1, 1)]);
  assert.deepEqual(groups.map((g) => g.current), [null, null]);
  assert.deepEqual(groups.flatMap((g) => g.tests.map((t) => t.id)), [1, 2]);
});
