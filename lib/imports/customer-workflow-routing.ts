export interface ImportCustomerWorkflowState {
  id: number;
  parserMode: string;
  demoSessionId: number | null;
  customerResolution: string | null;
  selectedGolfClientId: number | null;
  proposedFirstName: string | null;
  proposedLastName: string | null;
  proposedEmail: string | null;
  proposedPhone: string | null;
}

export function getCustomerPageRedirect(
  batch: Pick<ImportCustomerWorkflowState, "id" | "parserMode" | "demoSessionId">,
): string | null {
  if (batch.demoSessionId !== null) {
    return `/staff/imports/${batch.id}/map`;
  }
  if (batch.parserMode !== "trackman-result") {
    return `/staff/imports/${batch.id}`;
  }
  return null;
}

export function hasPersistedCustomerResolution(
  batch: Pick<
    ImportCustomerWorkflowState,
    | "customerResolution"
    | "selectedGolfClientId"
    | "proposedFirstName"
    | "proposedLastName"
    | "proposedEmail"
    | "proposedPhone"
  >,
): boolean {
  if (
    batch.customerResolution === "existing" &&
    Number.isSafeInteger(batch.selectedGolfClientId) &&
    (batch.selectedGolfClientId ?? 0) > 0
  ) {
    return true;
  }

  return (
    batch.customerResolution === "new" &&
    [
      batch.proposedFirstName,
      batch.proposedLastName,
      batch.proposedEmail,
      batch.proposedPhone,
    ].some((value) => value?.trim())
  );
}

export function getReviewPageRedirect(
  batch: ImportCustomerWorkflowState,
): string | null {
  if (
    batch.demoSessionId !== null ||
    batch.parserMode !== "trackman-result"
  ) {
    return null;
  }

  if (hasPersistedCustomerResolution(batch)) return null;

  return `/staff/imports/${batch.id}/customer`;
}
