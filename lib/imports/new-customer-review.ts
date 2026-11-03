import { emailMatchKey, phoneMatchKey } from "./customer-identifiers";

// Local duplicate detection for a proposed (staged) new customer.
// Pure and client-safe: no crypto or database access in this file.

export type DuplicateMatchKind = "email" | "phone" | "email_and_phone";

export interface ClientIdentity {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}

export interface DuplicateCandidate extends ClientIdentity {
  matchedOn: DuplicateMatchKind;
}

export interface ProposedIdentifiers {
  email: string | null;
  phone: string | null;
}

export type ReviewKind =
  | "none"
  | "exact_email"
  | "possible_phone"
  | "conflicting";

export interface NewCustomerReview {
  kind: ReviewKind;
  /** Binds a confirmation to the exact identifiers and candidate set shown. */
  signature: string;
  candidates: DuplicateCandidate[];
  confirmed: boolean;
}

/**
 * Compares against normalized stored values in application code, because
 * GolfClient email/phone are not unique and not normalized at rest. Never
 * matches by name.
 */
export function findDuplicateCandidates(
  clients: readonly ClientIdentity[],
  proposed: ProposedIdentifiers,
): DuplicateCandidate[] {
  const email = emailMatchKey(proposed.email);
  const phone = phoneMatchKey(proposed.phone);
  const candidates: DuplicateCandidate[] = [];

  for (const client of clients) {
    const emailMatch = email !== null && emailMatchKey(client.email) === email;
    const phoneMatch = phone !== null && phoneMatchKey(client.phone) === phone;
    if (!emailMatch && !phoneMatch) continue;
    candidates.push({
      ...client,
      matchedOn:
        emailMatch && phoneMatch ? "email_and_phone" : emailMatch ? "email" : "phone",
    });
  }

  return candidates.sort((a, b) => a.id - b.id);
}

export function classifyReview(
  candidates: readonly DuplicateCandidate[],
): ReviewKind {
  if (candidates.length === 0) return "none";
  if (candidates.length > 1) return "conflicting";
  return candidates[0]!.matchedOn === "phone" ? "possible_phone" : "exact_email";
}

export function isReviewBlocking(
  review: Pick<NewCustomerReview, "kind" | "confirmed"> | null,
): boolean {
  return review !== null && review.kind !== "none" && !review.confirmed;
}
