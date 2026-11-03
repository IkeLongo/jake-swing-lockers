// Staged TrackMan imports must be finalized through the staged workflow
// (customer resolution, GHL contact approval, finalization). The legacy
// /confirm route creates customers and DemoSessions without those checks, so
// it must never act on them.

export interface LegacyConfirmBlock {
  status: 409;
  code: "staged_workflow_required";
  error: string;
}

export function getLegacyConfirmBlock(batch: {
  parserMode: string;
  demoSessionId: number | null;
}): LegacyConfirmBlock | null {
  if (batch.demoSessionId !== null) return null;
  if (batch.parserMode !== "trackman-result") return null;
  return {
    status: 409,
    code: "staged_workflow_required",
    error:
      "Staged TrackMan imports must be completed through the customer, opportunity and confirmation workflow.",
  };
}
