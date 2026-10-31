import assert from "node:assert/strict";
import test from "node:test";
import { getStagedCustomerSummary } from "../lib/imports/staged-customer-summary";

const base = {
  customerResolution: null,
  proposedFirstName: null,
  proposedLastName: null,
  proposedEmail: null,
  proposedPhone: null,
  selectedGolfClient: null,
};

test("existing customer uses the selected GolfClient", () => {
  assert.deepEqual(
    getStagedCustomerSummary({
      ...base,
      customerResolution: "existing",
      proposedFirstName: "Ignored",
      selectedGolfClient: {
        firstName: "Isaac",
        lastName: "Longo",
        email: "i@example.com",
        phone: "555-0100",
      },
    }),
    { name: "Isaac Longo", contact: "i@example.com · 555-0100" },
  );
});

test("new customer uses proposed fields and only available contact parts", () => {
  assert.deepEqual(
    getStagedCustomerSummary({
      ...base,
      customerResolution: "new",
      proposedFirstName: "Sam",
      proposedEmail: "sam@example.com",
    }),
    { name: "Sam", contact: "sam@example.com" },
  );
});

test("missing name and contact fall back cleanly", () => {
  assert.deepEqual(getStagedCustomerSummary({ ...base, customerResolution: "new" }), {
    name: "Customer",
    contact: null,
  });
});
