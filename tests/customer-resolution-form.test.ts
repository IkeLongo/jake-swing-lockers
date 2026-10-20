import test from "node:test";
import assert from "node:assert/strict";
import { getNewCustomerFormValues } from "@/lib/imports/customer-resolution-form";
import type { CustomerResolutionState } from "@/lib/imports/customer-resolution";

const unresolved: CustomerResolutionState = {
  customerResolution: null,
  selectedGolfClientId: null,
  proposedFirstName: null,
  proposedLastName: null,
  proposedEmail: null,
  proposedPhone: null,
};

test("unresolved customer defaults use TrackMan name and email", () => {
  assert.deepEqual(
    getNewCustomerFormValues(unresolved, "Max Tucker", " MAX@example.com "),
    {
      firstName: "Max",
      lastName: "Tucker",
      email: "MAX@example.com",
      phone: "",
    },
  );
});

test("persisted new customer fields take precedence over TrackMan defaults", () => {
  const persisted: CustomerResolutionState = {
    customerResolution: "new",
    selectedGolfClientId: null,
    proposedFirstName: "Staff Edited",
    proposedLastName: "Name",
    proposedEmail: "edited@example.com",
    proposedPhone: "555-0100",
  };

  assert.deepEqual(
    getNewCustomerFormValues(persisted, "TrackMan Name", "trackman@example.com"),
    {
      firstName: "Staff Edited",
      lastName: "Name",
      email: "edited@example.com",
      phone: "555-0100",
    },
  );
});

test("persisted existing resolution uses TrackMan defaults only when adding new", () => {
  const persistedExisting: CustomerResolutionState = {
    ...unresolved,
    customerResolution: "existing",
    selectedGolfClientId: 12,
  };

  assert.deepEqual(
    getNewCustomerFormValues(
      persistedExisting,
      "TrackMan Name",
      "trackman@example.com",
    ),
    {
      firstName: "TrackMan",
      lastName: "Name",
      email: "trackman@example.com",
      phone: "",
    },
  );
});
