import { normalizeEmail } from "@/lib/auth/normalize";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CustomerMatchCandidate {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}

export type CustomerMatchResult =
  | { status: "no-email" }
  | { status: "no-match" }
  | { status: "matched"; customer: CustomerMatchCandidate }
  | { status: "ambiguous"; customers: CustomerMatchCandidate[] };

// ── Matcher ───────────────────────────────────────────────────────────────────

/**
 * Deterministic TrackMan → GolfClient resolution by exact normalized email only.
 *
 * GolfClient.email is not DB-unique and not guaranteed to be normalized at
 * rest, so candidates are compared in application code with normalizeEmail()
 * rather than relying on a database-level case-insensitive operator.
 *
 * Never matches by name or TrackMan Player ID — those are not authoritative
 * GolfClient identity in this repository.
 */
export function resolveCustomerMatches(
  candidates: CustomerMatchCandidate[],
  trackmanPlayerEmail: string | null,
): CustomerMatchResult {
  if (!trackmanPlayerEmail || !trackmanPlayerEmail.trim()) {
    return { status: "no-email" };
  }

  const target = normalizeEmail(trackmanPlayerEmail);
  const matches = candidates.filter(
    (c) => c.email && normalizeEmail(c.email) === target,
  );

  if (matches.length === 0) return { status: "no-match" };
  if (matches.length === 1) return { status: "matched", customer: matches[0] };
  return { status: "ambiguous", customers: matches };
}
