import type {
  ContactDiscovery,
  DiscoveredContact,
} from "./discoverStagedContacts";

// UI-side mirror of the server's approval rules. These only decide which
// controls are enabled and why; the approval API re-validates everything.

export type DiscrepancyKind = DiscoveredContact["discrepancies"][number];

const DISCREPANCY_LABELS: Record<string, string> = {
  email: "Email addresses differ",
  phone: "Phone numbers differ",
  firstName: "First names differ",
  lastName: "Last names differ",
};

export function discrepancyLabel(kind: string): string {
  return DISCREPANCY_LABELS[kind] ?? kind;
}

export function candidateApprovalBlock(
  discovery: ContactDiscovery,
  candidate: DiscoveredContact,
): string | null {
  if (candidate.wrongLocation) {
    return "Belongs to a different GHL location.";
  }
  if (!candidate.locationVerified) {
    return "GHL did not confirm this contact's location.";
  }
  if (candidate.linkedClients.length > 0) {
    return "Already linked to another customer.";
  }
  const savedId = discovery.savedLink.id;
  if (savedId && savedId !== candidate.id) {
    return "This customer is already linked to a different GHL contact.";
  }
  return null;
}

export function newContactBlock(discovery: ContactDiscovery): string | null {
  if (discovery.savedLink.id) {
    return "This customer already has a saved GHL contact.";
  }
  if (discovery.flags.incomplete) {
    return "GHL results are incomplete.";
  }
  if (
    (!discovery.searched.email && !discovery.searched.phone) ||
    discovery.unsearchable.length > 0
  ) {
    return "Every email and phone must be searchable in GHL.";
  }
  if (discovery.candidates.some((c) => c.reasons.includes("email"))) {
    return "A GHL contact already uses this email. Use that contact instead.";
  }
  return null;
}

export function missingDiscrepancyAcks(
  candidate: DiscoveredContact,
  acknowledged: readonly string[],
): string[] {
  return candidate.discrepancies.filter((d) => !acknowledged.includes(d));
}

export function missingCandidateAcks(
  discovery: ContactDiscovery,
  acknowledged: readonly string[],
): string[] {
  return discovery.candidates
    .map((c) => c.id)
    .filter((id) => !acknowledged.includes(id));
}

const STALE_CODES = new Set([
  "discovery_changed",
  "state_changed",
  "contact_not_in_discovery",
]);

export function isStaleApprovalCode(code: string | undefined): boolean {
  return code !== undefined && STALE_CODES.has(code);
}

export interface ContinueApproval {
  current: boolean;
}

export function canContinueWithApproval(
  approval: ContinueApproval | null,
): boolean {
  return approval?.current === true;
}

export function getApprovalContinueHint(
  approval: (ContinueApproval & { status: string }) | null,
): string | null {
  if (canContinueWithApproval(approval)) return null;
  if (approval?.status === "stale") {
    return "The customer changed since the GHL contact was approved. Review the GHL contact again.";
  }
  return "Choose a GHL contact (or approve creating a new one) to continue.";
}
