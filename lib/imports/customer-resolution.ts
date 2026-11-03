import { parseProposedIdentity } from "./customer-identifiers";

export interface CustomerResolutionState {
  customerResolution: "existing" | "new" | null;
  selectedGolfClientId: number | null;
  proposedFirstName: string | null;
  proposedLastName: string | null;
  proposedEmail: string | null;
  proposedPhone: string | null;
}

export function hasSameCustomerIdentity(
  current: CustomerResolutionState,
  next: CustomerResolutionState,
): boolean {
  if (current.customerResolution !== next.customerResolution) return false;

  if (current.customerResolution === "existing") {
    return current.selectedGolfClientId === next.selectedGolfClientId;
  }

  if (current.customerResolution === "new") {
    return (
      current.proposedFirstName === next.proposedFirstName &&
      current.proposedLastName === next.proposedLastName &&
      current.proposedEmail === next.proposedEmail &&
      current.proposedPhone === next.proposedPhone
    );
  }

  return true;
}

export type CustomerResolutionParseResult =
  | { success: true; state: CustomerResolutionState }
  | { success: false; error: string };

const EMPTY_STATE: CustomerResolutionState = {
  customerResolution: null,
  selectedGolfClientId: null,
  proposedFirstName: null,
  proposedLastName: null,
  proposedEmail: null,
  proposedPhone: null,
};

function parseProposedField(
  input: Record<string, unknown>,
  key: string,
): string | null | undefined {
  const value = input[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  return value.trim() || null;
}

const REVIEW_SIGNATURE_PATTERN = /^[0-9a-f]{64}$/;

export type NewCustomerConfirmationParseResult =
  | { success: true; submittedSignature: string | null }
  | { success: false; error: string };

// A bare `confirmNewCustomer: true` is never accepted: the signature of the
// reviewed candidate set must accompany it.
export function parseNewCustomerConfirmation(
  input: unknown,
): NewCustomerConfirmationParseResult {
  const body = (input ?? {}) as Record<string, unknown>;
  const confirm = body.confirmNewCustomer;
  const signature = body.reviewSignature;

  if (confirm === undefined || confirm === null || confirm === false) {
    return { success: true, submittedSignature: null };
  }
  if (confirm !== true) {
    return { success: false, error: "confirmNewCustomer must be a boolean." };
  }
  if (body.resolution !== "new") {
    return {
      success: false,
      error: "Only a new customer can be confirmed as a different person.",
    };
  }
  if (typeof signature !== "string" || !REVIEW_SIGNATURE_PATTERN.test(signature)) {
    return {
      success: false,
      error: "A review signature is required to confirm a new customer.",
    };
  }
  return { success: true, submittedSignature: signature };
}

export function parseCustomerResolution(
  input: unknown,
): CustomerResolutionParseResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { success: false, error: "Request body must be an object." };
  }

  const body = input as Record<string, unknown>;
  const resolution = body.resolution;

  if (resolution === null) {
    return { success: true, state: { ...EMPTY_STATE } };
  }

  if (resolution === "existing") {
    const selectedGolfClientId = body.selectedGolfClientId;
    if (
      typeof selectedGolfClientId !== "number" ||
      !Number.isSafeInteger(selectedGolfClientId) ||
      selectedGolfClientId <= 0
    ) {
      return {
        success: false,
        error: "A valid selectedGolfClientId is required for an existing customer.",
      };
    }

    return {
      success: true,
      state: {
        ...EMPTY_STATE,
        customerResolution: "existing",
        selectedGolfClientId,
      },
    };
  }

  if (resolution === "new") {
    const proposedFirstName = parseProposedField(body, "proposedFirstName");
    const proposedLastName = parseProposedField(body, "proposedLastName");
    const proposedEmail = parseProposedField(body, "proposedEmail");
    const proposedPhone = parseProposedField(body, "proposedPhone");

    if (
      proposedFirstName === undefined ||
      proposedLastName === undefined ||
      proposedEmail === undefined ||
      proposedPhone === undefined
    ) {
      return {
        success: false,
        error: "Proposed customer fields must be strings or null.",
      };
    }

    const identity = parseProposedIdentity({
      firstName: proposedFirstName,
      lastName: proposedLastName,
      email: proposedEmail,
      phone: proposedPhone,
    });
    if (!identity.ok) return { success: false, error: identity.error };

    return {
      success: true,
      state: {
        ...EMPTY_STATE,
        customerResolution: "new",
        proposedFirstName: identity.value.firstName,
        proposedLastName: identity.value.lastName,
        proposedEmail: identity.value.email,
        proposedPhone: identity.value.phone,
      },
    };
  }

  return {
    success: false,
    error: 'resolution must be "existing", "new", or null.',
  };
}
