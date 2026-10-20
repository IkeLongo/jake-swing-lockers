import { normalizeEmail } from "@/lib/auth/normalize";

export interface CustomerResolutionState {
  customerResolution: "existing" | "new" | null;
  selectedGolfClientId: number | null;
  proposedFirstName: string | null;
  proposedLastName: string | null;
  proposedEmail: string | null;
  proposedPhone: string | null;
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

    if (
      !proposedFirstName &&
      !proposedLastName &&
      !proposedEmail &&
      !proposedPhone
    ) {
      return {
        success: false,
        error: "Provide at least one proposed customer name or contact field.",
      };
    }

    return {
      success: true,
      state: {
        ...EMPTY_STATE,
        customerResolution: "new",
        proposedFirstName,
        proposedLastName,
        proposedEmail: proposedEmail ? normalizeEmail(proposedEmail) : null,
        proposedPhone,
      },
    };
  }

  return {
    success: false,
    error: 'resolution must be "existing", "new", or null.',
  };
}
