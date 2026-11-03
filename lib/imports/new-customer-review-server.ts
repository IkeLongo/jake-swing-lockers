import { createHash } from "crypto";
import {
  classifyReview,
  findDuplicateCandidates,
  type ClientIdentity,
  type DuplicateCandidate,
  type DuplicateMatchKind,
  type NewCustomerReview,
  type ProposedIdentifiers,
} from "./new-customer-review";

// Server-only: signature computation and the confirmation decision shared by
// the customer-resolution route. Finalization recomputes the signature itself
// with computeReviewSignature, so a stored approval is never trusted as-is.

export function computeReviewSignature(
  proposed: ProposedIdentifiers,
  candidates: readonly DuplicateCandidate[],
): string {
  const payload = JSON.stringify({
    v: 1,
    email: proposed.email,
    phone: proposed.phone,
    candidates: [...candidates]
      .sort((a, b) => a.id - b.id)
      .map((candidate) => [candidate.id, candidate.matchedOn]),
  });
  return createHash("sha256").update(payload).digest("hex");
}

export function buildNewCustomerReview(
  clients: readonly ClientIdentity[],
  proposed: ProposedIdentifiers,
  storedSignature: string | null,
): NewCustomerReview {
  const candidates = findDuplicateCandidates(clients, proposed);
  const signature = computeReviewSignature(proposed, candidates);
  return {
    kind: classifyReview(candidates),
    signature,
    candidates,
    confirmed:
      candidates.length > 0 &&
      storedSignature !== null &&
      storedSignature === signature,
  };
}

// Minimal audit snapshot: identifiers reviewed plus candidate IDs and reasons.
// Candidate names/emails/phones are intentionally not duplicated here.
export interface ReviewedCandidatesSnapshot {
  proposedEmail: string | null;
  proposedPhone: string | null;
  candidates: { id: number; matchedOn: DuplicateMatchKind }[];
}

export function buildReviewSnapshot(
  proposed: ProposedIdentifiers,
  candidates: readonly DuplicateCandidate[],
): ReviewedCandidatesSnapshot {
  return {
    proposedEmail: proposed.email,
    proposedPhone: proposed.phone,
    candidates: candidates.map((c) => ({ id: c.id, matchedOn: c.matchedOn })),
  };
}

export type NewCustomerSaveDecision =
  | {
      outcome: "save";
      confirmation:
        | { action: "clear" }
        | { action: "keep" }
        | {
            action: "set";
            signature: string;
            snapshot: ReviewedCandidatesSnapshot;
          };
      review: NewCustomerReview;
    }
  | {
      outcome: "review_required" | "review_changed";
      review: NewCustomerReview;
    };

/**
 * Decides whether a new-customer save may proceed. Candidates are always
 * recomputed from `clients`; the only client-supplied input is the signature
 * of the candidate set the staff member saw, which must still be current.
 */
export function decideNewCustomerSave(input: {
  clients: readonly ClientIdentity[];
  proposed: ProposedIdentifiers;
  /** Same customer identity as the one already persisted on the batch. */
  identityUnchanged: boolean;
  storedSignature: string | null;
  submittedSignature: string | null;
}): NewCustomerSaveDecision {
  const { proposed, submittedSignature } = input;
  const review = buildNewCustomerReview(input.clients, proposed, null);

  if (submittedSignature !== null && submittedSignature !== review.signature) {
    return { outcome: "review_changed", review };
  }

  if (review.candidates.length === 0) {
    return { outcome: "save", confirmation: { action: "clear" }, review };
  }

  if (submittedSignature !== null) {
    return {
      outcome: "save",
      confirmation: {
        action: "set",
        signature: review.signature,
        snapshot: buildReviewSnapshot(proposed, review.candidates),
      },
      review: { ...review, confirmed: true },
    };
  }

  if (input.identityUnchanged && input.storedSignature === review.signature) {
    return {
      outcome: "save",
      confirmation: { action: "keep" },
      review: { ...review, confirmed: true },
    };
  }

  return { outcome: "review_required", review };
}
