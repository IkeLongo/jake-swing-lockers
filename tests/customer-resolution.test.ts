import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCustomerResolution,
  parseNewCustomerConfirmation,
} from "@/lib/imports/customer-resolution";

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
    proposedPhone: " (210) 555-0100 ",
  });

  assert.deepEqual(result, {
    success: true,
    state: {
      customerResolution: "new",
      selectedGolfClientId: null,
      proposedFirstName: "Max",
      proposedLastName: "Tucker",
      proposedEmail: "max@example.com",
      proposedPhone: "+12105550100",
    },
  });
});

test("name-only new customer is rejected", () => {
  const result = parseCustomerResolution({ resolution: "new", proposedFirstName: "Max" });
  assert.equal(result.success, false);
});

test("identifier-only new customer is rejected", () => {
  assert.equal(
    parseCustomerResolution({ resolution: "new", proposedEmail: "max@example.com" }).success,
    false,
  );
});

test("malformed email or phone is rejected rather than discarded", () => {
  assert.equal(
    parseCustomerResolution({
      resolution: "new",
      proposedFirstName: "Max",
      proposedEmail: "not-an-email",
      proposedPhone: "2105550100",
    }).success,
    false,
  );
  assert.equal(
    parseCustomerResolution({
      resolution: "new",
      proposedFirstName: "Max",
      proposedEmail: "max@example.com",
      proposedPhone: "555-0100",
    }).success,
    false,
  );
  assert.equal(
    parseCustomerResolution({
      resolution: "new",
      proposedFirstName: "Max",
      proposedPhone: "abc",
    }).success,
    false,
  );
});

test("confirmation requires a well-formed review signature", () => {
  assert.deepEqual(parseNewCustomerConfirmation({ resolution: "new" }), {
    success: true,
    submittedSignature: null,
  });
  assert.equal(
    parseNewCustomerConfirmation({ resolution: "new", confirmNewCustomer: true }).success,
    false,
  );
  assert.equal(
    parseNewCustomerConfirmation({
      resolution: "new",
      confirmNewCustomer: true,
      reviewSignature: "short",
    }).success,
    false,
  );
  assert.deepEqual(
    parseNewCustomerConfirmation({
      resolution: "new",
      confirmNewCustomer: true,
      reviewSignature: "a".repeat(64),
    }),
    { success: true, submittedSignature: "a".repeat(64) },
  );
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
