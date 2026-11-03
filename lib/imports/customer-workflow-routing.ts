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
    [batch.proposedFirstName, batch.proposedLastName].some((v) => v?.trim()) &&
    [batch.proposedEmail, batch.proposedPhone].some((v) => v?.trim())
  );
}

/**
 * `ghlDecision` is the current, persisted GHL contact decision (see
 * `getCurrentGhlDecision`); null means unresolved or stale. Legacy batches
 * linked to a DemoSession and non-TrackMan batches are never gated.
 */
export function getReviewPageRedirect(
  batch: ImportCustomerWorkflowState,
  ghlDecision: "existing" | "new" | null,
): string | null {
  if (
    batch.demoSessionId !== null ||
    batch.parserMode !== "trackman-result"
  ) {
    return null;
  }

  if (!hasPersistedCustomerResolution(batch) || ghlDecision === null) {
    return `/staff/imports/${batch.id}/customer`;
  }

  return null;
}
