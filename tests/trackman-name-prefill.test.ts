import test from "node:test";
import assert from "node:assert/strict";
import { getTrackManNamePrefill } from "@/lib/imports/trackman-name-prefill";

test("splits a two-part name", () => {
  assert.deepEqual(getTrackManNamePrefill("Max Tucker"), {
    firstName: "Max",
    lastName: "Tucker",
  });
});

test("uses a single token as the first name", () => {
  assert.deepEqual(getTrackManNamePrefill("Max"), {
    firstName: "Max",
    lastName: "",
  });
});

test("splits multiple tokens at the final whitespace boundary", () => {
  assert.deepEqual(getTrackManNamePrefill("Mary Jane Van Doe"), {
    firstName: "Mary Jane Van",
    lastName: "Doe",
  });
});

test("normalizes repeated whitespace", () => {
  assert.deepEqual(getTrackManNamePrefill("  Mary   Jane  Doe "), {
    firstName: "Mary Jane",
    lastName: "Doe",
  });
});

test("handles blank and missing names", () => {
  assert.deepEqual(getTrackManNamePrefill("   "), {
    firstName: "",
    lastName: "",
  });
  assert.deepEqual(getTrackManNamePrefill(null), {
    firstName: "",
    lastName: "",
  });
  assert.deepEqual(getTrackManNamePrefill(undefined), {
    firstName: "",
    lastName: "",
  });
});
