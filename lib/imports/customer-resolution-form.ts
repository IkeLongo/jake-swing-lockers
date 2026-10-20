import { getTrackManNamePrefill } from "@/lib/imports/trackman-name-prefill";
import type { CustomerResolutionState } from "@/lib/imports/customer-resolution";

export interface NewCustomerFormValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export function getNewCustomerFormValues(
  state: CustomerResolutionState,
  trackmanPlayerName: string | null,
  trackmanPlayerEmail: string | null,
): NewCustomerFormValues {
  if (state.customerResolution === "new") {
    return {
      firstName: state.proposedFirstName ?? "",
      lastName: state.proposedLastName ?? "",
      email: state.proposedEmail ?? "",
      phone: state.proposedPhone ?? "",
    };
  }

  const name = getTrackManNamePrefill(trackmanPlayerName);
  return {
    ...name,
    email: trackmanPlayerEmail?.trim() ?? "",
    phone: "",
  };
}
