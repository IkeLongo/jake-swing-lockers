import test from "node:test";
import assert from "node:assert/strict";
import { parseCustomerResolution } from "@/lib/imports/customer-resolution";

test("existing resolution requires a valid selected customer ID", () => {
  assert.deepEqual(parseCustomerResolution({ resolution: "existing", selectedGolfClientId: 12 }), {
    success: true,
    state: {
      customerResolution: "existing",
      selectedGolfClientId: 12,
      proposedFirstName: null,
      proposedLastName: null,
      proposedEmail: null,
      proposedPhone: null,
    },
  });

  assert.equal(
    parseCustomerResolution({ resolution: "existing" }).success,
    false,
  );
});

test("new resolution clears selected ID and normalizes proposed fields", () => {
  const result = parseCustomerResolution({
    resolution: "new",
    selectedGolfClientId: 12,
    proposedFirstName: " Max ",
    proposedLastName: "Tucker ",
    proposedEmail: " MAX@Example.com ",
    proposedPhone: " 555-0100 ",
  });

  assert.deepEqual(result, {
    success: true,
    state: {
      customerResolution: "new",
      selectedGolfClientId: null,
      proposedFirstName: "Max",
      proposedLastName: "Tucker",
      proposedEmail: "max@example.com",
      proposedPhone: "555-0100",
    },
  });
});

test("existing resolution clears any proposed customer fields", () => {
  const result = parseCustomerResolution({
    resolution: "existing",
    selectedGolfClientId: 7,
    proposedFirstName: "Untrusted",
    proposedEmail: "untrusted@example.com",
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.state.proposedFirstName, null);
    assert.equal(result.state.proposedEmail, null);
  }
});

test("unresolved resolution clears the selected ID and all proposed fields", () => {
  const result = parseCustomerResolution({
    resolution: null,
    selectedGolfClientId: 7,
    proposedFirstName: "Untrusted",
    proposedEmail: "untrusted@example.com",
  });

  assert.deepEqual(result, {
    success: true,
    state: {
      customerResolution: null,
      selectedGolfClientId: null,
      proposedFirstName: null,
      proposedLastName: null,
      proposedEmail: null,
      proposedPhone: null,
    },
  });
});

test("invalid resolution and empty new-customer data are rejected", () => {
  assert.equal(parseCustomerResolution({ resolution: "other" }).success, false);
  assert.equal(
    parseCustomerResolution({
      resolution: "new",
      proposedFirstName: " ",
      proposedLastName: null,
      proposedEmail: null,
      proposedPhone: null,
    }).success,
    false,
  );
});
