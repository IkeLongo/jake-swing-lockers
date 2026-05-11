// ── Types ─────────────────────────────────────────────────────────────────────

export type IdentifierType = "email" | "phone";

export interface NormalizedIdentifier {
  value: string;
  type: IdentifierType;
}

// ── Email ─────────────────────────────────────────────────────────────────────

/**
 * Normalize an email address: trim whitespace and lowercase.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ── Phone ─────────────────────────────────────────────────────────────────────

/**
 * Normalize a US phone number to E.164-ish format: "+1XXXXXXXXXX".
 *
 * Strips all non-digit characters, then:
 * - If 10 digits: prepend "+1"
 * - If 11 digits and starts with "1": prepend "+"
 * - Otherwise: return digits as-is (future international support)
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");

  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  // Non-standard — return stripped digits so the value is at least consistent
  return digits;
}

// ── Detect & normalize ────────────────────────────────────────────────────────

/**
 * Detect whether an identifier string is an email address or a phone number,
 * normalize it accordingly, and return both the normalized value and the type.
 *
 * Heuristic:
 *   - If the trimmed value contains "@" it is treated as email.
 *   - Otherwise it is treated as phone.
 *
 * Does NOT validate format — validation is left to the API layer.
 */
export function normalizeIdentifier(raw: string): NormalizedIdentifier {
  const trimmed = raw.trim();

  if (trimmed.includes("@")) {
    return {
      value: normalizeEmail(trimmed),
      type: "email",
    };
  }

  return {
    value: normalizePhone(trimmed),
    type: "phone",
  };
}
