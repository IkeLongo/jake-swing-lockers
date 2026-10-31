export interface StagedCustomerSummary {
  name: string;
  contact: string | null;
}

interface CustomerFields {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}

interface StagedCustomerBatch {
  customerResolution: string | null;
  proposedFirstName: string | null;
  proposedLastName: string | null;
  proposedEmail: string | null;
  proposedPhone: string | null;
  selectedGolfClient: CustomerFields | null;
}

export function summarizeCustomer(customer: CustomerFields): StagedCustomerSummary {
  const name =
    [customer.firstName, customer.lastName]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(" ") || "Customer";
  const contact = [customer.email, customer.phone]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" · ");
  return { name, contact: contact || null };
}

export function getStagedCustomerSummary(
  batch: StagedCustomerBatch,
): StagedCustomerSummary {
  if (batch.customerResolution === "existing" && batch.selectedGolfClient) {
    return summarizeCustomer(batch.selectedGolfClient);
  }
  return summarizeCustomer({
    firstName: batch.proposedFirstName,
    lastName: batch.proposedLastName,
    email: batch.proposedEmail,
    phone: batch.proposedPhone,
  });
}
