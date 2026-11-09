import { createHash } from "crypto";
import type {
  ContactDiscovery,
  DiscoveredContact,
  DiscoveryMatchReason,
  IdentityDiscrepancy,
} from "@/lib/ghl/discoverStagedContacts";
import { computeDiscoverySignature } from "@/lib/ghl/discoverySignature";
import { parseProposedIdentity } from "./customer-identifiers";
import {
  hasSameCustomerIdentity,
  type CustomerResolutionState,
} from "./customer-resolution";

/** A saved customer change keeps a GHL approval only if the identity is unchanged. */
export function shouldClearGhlApprovalOnCustomerChange(
  current: CustomerResolutionState,
  next: CustomerResolutionState,
): boolean {
  return !hasSameCustomerIdentity(current, next);
}

// Persisted staff decision about which GHL contact a staged fitting uses.
//
//   unresolved         no decision (all fields NULL)
//   approved_existing  decision "existing" + approvedGhlContactId
//   approved_new       decision "new" (the contact is created at CRM sync)
//   stale              stored fields no longer match the current local identity
//
// Nothing here trusts client-supplied contact details: the server recomputes
// discovery and the client only supplies the contact ID it chose, the
// discovery signature it reviewed, and its explicit acknowledgments.

export type GhlContactDecision = "existing" | "new";
export type GhlApprovalStatus =
  | "unresolved"
  | "approved_existing"
  | "approved_new"
  | "stale";

export interface LocalIdentity {
  kind: "existing" | "new";
  golfClientId: number | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}

export interface GhlReviewSnapshot {
  v: 1;
  discoverySignature: string;
  incomplete: boolean;
  /** IDs, reasons and flags only; no names, emails or phone numbers. */
  candidates: {
    id: string;
    reasons: DiscoveryMatchReason[];
    discrepancies: IdentityDiscrepancy[];
    locationVerified: boolean;
    linkedClientIds: number[];
  }[];
  acknowledgedDiscrepancies: IdentityDiscrepancy[];
  acknowledgedCandidateIds: string[];
}

export interface StoredGhlApproval {
  decision: string | null;
  approvedContactId: string | null;
  signature: string | null;
  approvedAt: Date | null;
  approvedByStaffUserId: number | null;
  snapshot: unknown;
}

export type ApprovalRequest =
  | { action: "clear" }
  | {
      action: "approve_existing";
      contactId: string;
      discoverySignature: string;
      acknowledgedDiscrepancies: IdentityDiscrepancy[];
    }
  | {
      action: "approve_new";
      discoverySignature: string;
      acknowledgedCandidateIds: string[];
    };

export type ApprovalErrorCode =
  | "invalid_request"
  | "invalid_contact_id"
  | "discovery_changed"
  | "contact_not_in_discovery"
  | "location_unverified"
  | "linked_to_other_customer"
  | "saved_contact_conflict"
  | "acknowledgment_required"
  | "discovery_incomplete"
  | "nothing_searched"
  | "email_match_exists"
  | "phone_match_exists"
  | "identifier_conflict"
  | "multiple_matches"
  | "contact_match_exists"
  | "candidate_acknowledgment_required";

export interface ApprovalError {
  ok: false;
  httpStatus: 400 | 409;
  code: ApprovalErrorCode;
  error: string;
  /** Machine-readable extras for the UI (e.g. the discrepancies to acknowledge). */
  details?: Record<string, unknown>;
}

export interface ApprovalOutcome {
  ok: true;
  decision: GhlContactDecision;
  approvedContactId: string | null;
  snapshot: GhlReviewSnapshot;
  signature: string;
}

const DISCREPANCIES: readonly IdentityDiscrepancy[] = [
  "email",
  "phone",
  "firstName",
  "lastName",
];
const CONTACT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const text = (v: string | null | undefined) => v?.trim() || null;

const invalid = (error: string): ApprovalError => ({
  ok: false,
  httpStatus: 400,
  code: "invalid_request",
  error,
});

const conflict = (
  code: ApprovalErrorCode,
  error: string,
  details?: Record<string, unknown>,
): ApprovalError => ({ ok: false, httpStatus: 409, code, error, details });

export function isValidGhlContactId(value: unknown): value is string {
  return typeof value === "string" && CONTACT_ID_PATTERN.test(value);
}

export function parseApprovalRequest(
  input: unknown,
): { ok: true; request: ApprovalRequest } | ApprovalError {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return invalid("Request body must be an object.");
  }
  const body = input as Record<string, unknown>;

  if (body.action === "clear") return { ok: true, request: { action: "clear" } };

  const signature = body.discoverySignature;
  if (typeof signature !== "string" || !/^[0-9a-f]{64}$/.test(signature)) {
    return invalid("A discoverySignature from the displayed review is required.");
  }

  if (body.action === "approve_existing") {
    if (!isValidGhlContactId(body.contactId)) {
      return {
        ok: false,
        httpStatus: 400,
        code: "invalid_contact_id",
        error: "A valid GHL contact ID is required.",
      };
    }
    const ack = body.acknowledgedDiscrepancies ?? [];
    if (
      !Array.isArray(ack) ||
      !ack.every((v) => DISCREPANCIES.includes(v as IdentityDiscrepancy))
    ) {
      return invalid("acknowledgedDiscrepancies contains an unknown value.");
    }
    return {
      ok: true,
      request: {
        action: "approve_existing",
        contactId: body.contactId,
        discoverySignature: signature,
        acknowledgedDiscrepancies: [...new Set(ack as IdentityDiscrepancy[])],
      },
    };
  }

  if (body.action === "approve_new") {
    const ids = body.acknowledgedCandidateIds ?? [];
    if (!Array.isArray(ids) || !ids.every(isValidGhlContactId)) {
      return invalid("acknowledgedCandidateIds must be a list of contact IDs.");
    }
    return {
      ok: true,
      request: {
        action: "approve_new",
        discoverySignature: signature,
        acknowledgedCandidateIds: [...new Set(ids as string[])],
      },
    };
  }

  return invalid('action must be "approve_existing", "approve_new" or "clear".');
}

export function buildLocalIdentity(input: {
  kind: "existing" | "new";
  golfClientId: number | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}): LocalIdentity {
  return {
    kind: input.kind,
    golfClientId: input.kind === "existing" ? input.golfClientId : null,
    firstName: text(input.firstName),
    lastName: text(input.lastName),
    email: text(input.email),
    phone: text(input.phone),
  };
}

/** The identity of the persisted batch customer, or null when unresolved. */
export function resolveBatchLocalIdentity(
  batch: {
    customerResolution: string | null;
    selectedGolfClientId: number | null;
    proposedFirstName: string | null;
    proposedLastName: string | null;
    proposedEmail: string | null;
    proposedPhone: string | null;
  },
  client: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  } | null,
): LocalIdentity | null {
  if (batch.customerResolution === "existing") {
    if (!client || batch.selectedGolfClientId === null) return null;
    return buildLocalIdentity({
      kind: "existing",
      golfClientId: batch.selectedGolfClientId,
      firstName: client.firstName,
      lastName: client.lastName,
      email: client.email,
      phone: client.phone,
    });
  }
  if (batch.customerResolution === "new") {
    const parsed = parseProposedIdentity({
      firstName: batch.proposedFirstName,
      lastName: batch.proposedLastName,
      email: batch.proposedEmail,
      phone: batch.proposedPhone,
    });
    if (!parsed.ok) return null;
    return buildLocalIdentity({ kind: "new", golfClientId: null, ...parsed.value });
  }
  return null;
}

export function computeApprovalSignature(input: {
  identity: LocalIdentity;
  decision: GhlContactDecision;
  approvedContactId: string | null;
  snapshot: GhlReviewSnapshot;
}): string {
  const { identity, snapshot } = input;
  const payload = JSON.stringify({
    v: 1,
    identity: [
      identity.kind,
      identity.golfClientId,
      identity.firstName,
      identity.lastName,
      identity.email,
      identity.phone,
    ],
    decision: input.decision,
    contact: input.approvedContactId,
    discovery: snapshot.discoverySignature,
    incomplete: snapshot.incomplete,
    candidates: [...snapshot.candidates]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((c) => [
        c.id,
        c.reasons,
        [...c.discrepancies].sort(),
        c.locationVerified,
        [...c.linkedClientIds].sort((a, b) => a - b),
      ]),
    ackDiscrepancies: [...snapshot.acknowledgedDiscrepancies].sort(),
    ackCandidates: [...snapshot.acknowledgedCandidateIds].sort(),
  });
  return createHash("sha256").update(payload).digest("hex");
}

function buildSnapshot(
  discovery: ContactDiscovery,
  discoverySignature: string,
  acknowledgedDiscrepancies: IdentityDiscrepancy[],
  acknowledgedCandidateIds: string[],
): GhlReviewSnapshot {
  return {
    v: 1,
    discoverySignature,
    incomplete: discovery.flags.incomplete,
    candidates: discovery.candidates.map((c) => ({
      id: c.id,
      reasons: c.reasons,
      discrepancies: c.discrepancies,
      locationVerified: c.locationVerified,
      linkedClientIds: c.linkedClients.map((l) => l.id),
    })),
    acknowledgedDiscrepancies: [...acknowledgedDiscrepancies].sort(),
    acknowledgedCandidateIds: [...acknowledgedCandidateIds].sort(),
  };
}

function finish(
  identity: LocalIdentity,
  decision: GhlContactDecision,
  approvedContactId: string | null,
  snapshot: GhlReviewSnapshot,
): ApprovalOutcome {
  return {
    ok: true,
    decision,
    approvedContactId,
    snapshot,
    signature: computeApprovalSignature({
      identity,
      decision,
      approvedContactId,
      snapshot,
    }),
  };
}

/**
 * Validates an approve request against a freshly recomputed discovery. Pure:
 * `discovery` must come from the server, never from the client.
 */
export function evaluateApproval(input: {
  request: Exclude<ApprovalRequest, { action: "clear" }>;
  identity: LocalIdentity;
  discovery: ContactDiscovery;
}): ApprovalOutcome | ApprovalError {
  const { request, identity, discovery } = input;
  const currentSignature = computeDiscoverySignature(discovery);

  if (request.discoverySignature !== currentSignature) {
    return conflict(
      "discovery_changed",
      "The GHL contacts changed since you reviewed them. Look up the contacts again and review the results.",
    );
  }

  const savedId = discovery.savedLink.id;

  if (request.action === "approve_existing") {
    const candidate: DiscoveredContact | undefined = discovery.candidates.find(
      (c) => c.id === request.contactId,
    );
    if (!candidate) {
      return conflict(
        "contact_not_in_discovery",
        "That contact is not one of the current matches. Look up the contacts again.",
      );
    }
    if (!candidate.locationVerified || candidate.wrongLocation) {
      return conflict(
        "location_unverified",
        candidate.wrongLocation
          ? "That contact belongs to a different GHL location."
          : "GHL did not confirm that this contact belongs to this location, so it cannot be approved.",
      );
    }
    if (candidate.linkedClients.length > 0) {
      return conflict(
        "linked_to_other_customer",
        "That contact is already linked to another customer.",
        { linkedClients: candidate.linkedClients },
      );
    }
    if (savedId && savedId !== candidate.id) {
      return conflict(
        "saved_contact_conflict",
        "This customer is already linked to a different GHL contact. Reassigning it is not supported.",
      );
    }
    const required = candidate.discrepancies;
    const missing = required.filter(
      (d) => !request.acknowledgedDiscrepancies.includes(d),
    );
    if (missing.length > 0) {
      return conflict(
        "acknowledgment_required",
        "Acknowledge the differences between this customer and the GHL contact to approve it.",
        { required, missing },
      );
    }
    return finish(
      identity,
      "existing",
      candidate.id,
      buildSnapshot(discovery, currentSignature, required, []),
    );
  }

  // approve_new
  if (savedId) {
    return conflict(
      "saved_contact_conflict",
      "This customer is already linked to a GHL contact, so a new contact cannot be created.",
    );
  }
  if (discovery.flags.incomplete) {
    return conflict(
      "discovery_incomplete",
      "The GHL search returned incomplete results, so creating a new contact cannot be approved.",
    );
  }
  if (
    (!discovery.searched.email && !discovery.searched.phone) ||
    discovery.unsearchable.length > 0
  ) {
    return conflict(
      "nothing_searched",
      "Every customer identifier must be searchable in GHL before a new contact can be approved.",
      { unsearchable: discovery.unsearchable },
    );
  }
  if (discovery.flags.identifierConflict) {
    return conflict(
      "identifier_conflict",
      "The customer's email and phone match different GHL contacts. Review the identity and approve the correct existing contact.",
      {
        candidateIds: discovery.candidates.map((candidate) => candidate.id),
      },
    );
  }
  if (discovery.flags.multipleMatches || discovery.flags.incomplete) {
    return conflict(
      "multiple_matches",
      "GHL returned multiple or incomplete contact matches. Review the contacts and approve the correct existing contact.",
      { candidateIds: discovery.candidates.map((candidate) => candidate.id) },
    );
  }
  const emailMatches = discovery.candidates.filter((c) =>
    c.reasons.includes("email"),
  );
  if (emailMatches.length > 0) {
    return conflict(
      "email_match_exists",
      "A GHL contact already uses this email address. Approve that contact instead.",
      { candidateIds: emailMatches.map((c) => c.id) },
    );
  }
  const phoneMatches = discovery.candidates.filter((c) =>
    c.reasons.includes("phone"),
  );
  if (phoneMatches.length > 0) {
    return conflict(
      "phone_match_exists",
      "A GHL contact already uses this phone number. Review and approve the existing contact instead of creating another.",
      { candidateIds: phoneMatches.map((c) => c.id) },
    );
  }
  if (discovery.candidates.length > 0) {
    return conflict(
      "contact_match_exists",
      "A GHL contact already matches this customer. Review and approve the existing contact instead of creating another.",
      { candidateIds: discovery.candidates.map((candidate) => candidate.id) },
    );
  }
  if (request.acknowledgedCandidateIds.length > 0) {
    return conflict(
      "candidate_acknowledgment_required",
      "The acknowledged GHL contacts no longer match the current discovery. Review the contacts again.",
    );
  }
  return finish(
    identity,
    "new",
    null,
    buildSnapshot(discovery, currentSignature, [], []),
  );
}

function parseSnapshot(value: unknown): GhlReviewSnapshot | null {
  if (typeof value !== "object" || value === null) return null;
  const s = value as Record<string, unknown>;
  if (
    s.v !== 1 ||
    typeof s.discoverySignature !== "string" ||
    typeof s.incomplete !== "boolean" ||
    !Array.isArray(s.candidates) ||
    !Array.isArray(s.acknowledgedDiscrepancies) ||
    !Array.isArray(s.acknowledgedCandidateIds)
  ) {
    return null;
  }
  return value as GhlReviewSnapshot;
}

/**
 * Local-only (no GHL call): classifies the stored fields against the current
 * local identity. Any identity change makes a stored approval "stale".
 */
export function getApprovalStatus(
  stored: StoredGhlApproval,
  identity: LocalIdentity | null,
): GhlApprovalStatus {
  const empty =
    stored.decision === null &&
    stored.approvedContactId === null &&
    stored.signature === null &&
    stored.snapshot === null;
  if (empty) return "unresolved";
  if (!identity) return "stale";

  const decision = stored.decision;
  if (decision !== "existing" && decision !== "new") return "stale";
  if (decision === "existing" && !isValidGhlContactId(stored.approvedContactId)) {
    return "stale";
  }
  if (decision === "new" && stored.approvedContactId !== null) return "stale";

  const snapshot = parseSnapshot(stored.snapshot);
  if (!snapshot || !stored.signature) return "stale";
  if (
    decision === "new" &&
    (snapshot.incomplete ||
      snapshot.candidates.length > 0 ||
      snapshot.acknowledgedCandidateIds.length > 0)
  ) {
    return "stale";
  }

  const expected = computeApprovalSignature({
    identity,
    decision,
    approvedContactId: stored.approvedContactId,
    snapshot,
  });
  if (expected !== stored.signature) return "stale";
  return decision === "existing" ? "approved_existing" : "approved_new";
}

export function hasCurrentGhlApproval(status: GhlApprovalStatus): boolean {
  return status === "approved_existing" || status === "approved_new";
}

/** True when the effective contact decision differs (downstream state must reset). */
export function ghlDecisionChanged(
  previous: { decision: string | null; approvedContactId: string | null },
  next: { decision: string | null; approvedContactId: string | null },
): boolean {
  return (
    previous.decision !== next.decision ||
    previous.approvedContactId !== next.approvedContactId
  );
}
