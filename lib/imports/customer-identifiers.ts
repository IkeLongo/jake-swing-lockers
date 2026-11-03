import { normalizeEmail, normalizePhone } from "@/lib/auth/normalize";

// Strict parsing for staged new-customer identity. Malformed input is an
// error, never silently dropped.

export const MAX_IDENTITY_FIELD_LENGTH = 191;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type IdentifierParse =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

export function parseEmailStrict(raw: string | null | undefined): IdentifierParse {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return { ok: true, value: null };
  const email = normalizeEmail(trimmed);
  if (email.length > MAX_IDENTITY_FIELD_LENGTH || !EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  return { ok: true, value: email };
}

// Accepts a 10/11-digit US number or an international number with a leading "+".
export function parsePhoneStrict(raw: string | null | undefined): IdentifierParse {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return { ok: true, value: null };
  const invalid: IdentifierParse = {
    ok: false,
    error: "Enter a valid phone number (10-digit US number, or include the country code with +).",
  };
  if (!/^[+\d\s().-]+$/.test(trimmed)) return invalid;

  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15
      ? { ok: true, value: `+${digits}` }
      : invalid;
  }
  const normalized = normalizePhone(trimmed);
  return /^\+1\d{10}$/.test(normalized)
    ? { ok: true, value: normalized }
    : invalid;
}

/**
 * Comparison key for a stored phone in any historical format, e.g.
 * "(210) 555-0100", "210-555-0100", "12105550100" and "+12105550100" all
 * share one key. Returns null when the value is too short to compare safely.
 */
export function phoneMatchKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  return digits.length === 10 ? `1${digits}` : digits;
}

export function emailMatchKey(email: string | null | undefined): string | null {
  const value = email ? normalizeEmail(email) : "";
  return value || null;
}

export interface ProposedIdentityInput {
  firstName: string | null | undefined;
  lastName: string | null | undefined;
  email: string | null | undefined;
  phone: string | null | undefined;
}

export interface ProposedIdentity {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}

export type ProposedIdentityParse =
  | { ok: true; value: ProposedIdentity }
  | { ok: false; error: string };

export function parseProposedIdentity(
  input: ProposedIdentityInput,
): ProposedIdentityParse {
  const firstName = input.firstName?.trim() || null;
  const lastName = input.lastName?.trim() || null;
  if (!firstName && !lastName) {
    return { ok: false, error: "Enter the customer's name." };
  }
  if (
    (firstName?.length ?? 0) > MAX_IDENTITY_FIELD_LENGTH ||
    (lastName?.length ?? 0) > MAX_IDENTITY_FIELD_LENGTH
  ) {
    return { ok: false, error: "Customer name is too long." };
  }

  const email = parseEmailStrict(input.email);
  if (!email.ok) return email;
  const phone = parsePhoneStrict(input.phone);
  if (!phone.ok) return phone;
  if (!email.value && !phone.value) {
    return { ok: false, error: "Enter a valid email address or phone number." };
  }

  return {
    ok: true,
    value: { firstName, lastName, email: email.value, phone: phone.value },
  };
}
