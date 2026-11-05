import { normalizeEmail, normalizePhone } from "@/lib/auth/normalize";

// Conservative GHL contact resolution for the staged TrackMan CRM sync.
//
// Unlike the legacy upsertContact, this never picks "the first match", never
// overwrites an existing contact, and never treats a failed lookup as "no
// match". Anything ambiguous stops with ContactNeedsReviewError so a person is
// never silently associated with the wrong GHL contact.

export interface StagedContactInput {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}

export interface GhlContactLite {
  id: string;
  locationId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface ContactLookupPage {
  contacts: GhlContactLite[];
  /** True when GHL reports more results than were returned. */
  hasMore: boolean;
}

export interface StagedContactApi {
  /** Resolves null only when the contact does not exist; throws otherwise. */
  getContact(id: string): Promise<GhlContactLite | null>;
  /** Throws on any lookup failure. */
  lookupByEmail(email: string): Promise<ContactLookupPage>;
  lookupByPhone(phone: string): Promise<ContactLookupPage>;
  createContact(input: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
  }): Promise<{ id: string }>;
  locationId(): string;
}

export type ContactReviewReason =
  | "missing_identifier"
  | "wrong_location"
  | "multiple_matches"
  | "identifier_conflict"
  | "identity_conflict"
  | "duplicate_on_create";

export class ContactNeedsReviewError extends Error {
  readonly code = "contact-needs-review" as const;
  constructor(
    readonly reason: ContactReviewReason,
    message: string,
  ) {
    super(message);
    this.name = "ContactNeedsReviewError";
  }
}

export type ContactResolutionSource =
  | "saved"
  | "email"
  | "phone"
  | "email_and_phone"
  | "created";

export interface StagedContactResolution {
  id: string;
  source: ContactResolutionSource;
}

export function usableEmail(email: string | null): string | null {
  const value = email ? normalizeEmail(email) : "";
  return /^[^\s@]+@[^\s@]+$/.test(value) ? value : null;
}

// Lookups require E.164; anything else cannot be searched reliably.
export function usablePhone(phone: string | null): string | null {
  const value = phone ? normalizePhone(phone) : "";
  return /^\+\d{8,15}$/.test(value) ? value : null;
}

function sameText(a: string | null | undefined, b: string | null | undefined) {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

export function conflicts(
  a: string | null | undefined,
  b: string | null | undefined,
  eq: (x: string, y: string) => boolean = (x, y) => sameText(x, y),
): boolean {
  if (!a?.trim() || !b?.trim()) return false;
  return !eq(a, b);
}

export const samePhone = (x: string, y: string) => normalizePhone(x) === normalizePhone(y);
export const sameEmail = (x: string, y: string) => normalizeEmail(x) === normalizeEmail(y);

/** The identifier that did NOT match is checked, along with the names. */
function hasIdentityConflict(
  contact: GhlContactLite,
  input: StagedContactInput,
  matchedOn: "email" | "phone",
): boolean {
  return (
    (matchedOn === "email"
      ? conflicts(input.phone, contact.phone, samePhone)
      : conflicts(input.email, contact.email, sameEmail)) ||
    conflicts(input.firstName, contact.firstName) ||
    conflicts(input.lastName, contact.lastName)
  );
}

function single(
  page: ContactLookupPage,
  label: string,
): GhlContactLite | null {
  const distinct = new Map(page.contacts.map((c) => [c.id, c]));
  if (distinct.size > 1 || page.hasMore) {
    throw new ContactNeedsReviewError(
      "multiple_matches",
      `Multiple GHL contacts match this customer's ${label}. Review the contacts in GHL.`,
    );
  }
  return [...distinct.values()][0] ?? null;
}

export async function resolveStagedContact(
  api: StagedContactApi,
  input: StagedContactInput,
  savedContactId: string | null,
): Promise<StagedContactResolution> {
  // 1. A saved ID is verified before reuse. A deleted contact falls through to
  //    the search below, so the stale link is replaced rather than trusted.
  if (savedContactId) {
    const existing = await api.getContact(savedContactId);
    if (existing) {
      if (existing.locationId && existing.locationId !== api.locationId()) {
        throw new ContactNeedsReviewError(
          "wrong_location",
          "The saved GHL contact belongs to a different GHL location.",
        );
      }
      return { id: existing.id, source: "saved" };
    }
  }

  const email = usableEmail(input.email);
  const phone = usablePhone(input.phone);
  if (!email && !phone) {
    throw new ContactNeedsReviewError(
      "missing_identifier",
      "This customer has no usable email or phone number to match or create a GHL contact.",
    );
  }

  // 2. Independent exact lookups; failures propagate as retryable errors.
  const byEmail = email ? single(await api.lookupByEmail(email), "email") : null;
  const byPhone = phone ? single(await api.lookupByPhone(phone), "phone") : null;

  if (byEmail && byPhone) {
    if (byEmail.id !== byPhone.id) {
      throw new ContactNeedsReviewError(
        "identifier_conflict",
        "This customer's email and phone number match different GHL contacts.",
      );
    }
    return { id: byEmail.id, source: "email_and_phone" };
  }

  const matched = byEmail ?? byPhone;
  if (matched) {
    const matchedOn = byEmail ? "email" : "phone";
    if (hasIdentityConflict(matched, input, matchedOn)) {
      throw new ContactNeedsReviewError(
        "identity_conflict",
        `A GHL contact matches this customer's ${matchedOn} but has conflicting identity details.`,
      );
    }
    return { id: matched.id, source: matchedOn };
  }

  // 3. No match: create. A duplicate rejection means GHL knows a contact our
  //    lookups did not find, so it is surfaced rather than silently reused.
  try {
    const created = await api.createContact({
      ...(input.firstName ? { firstName: input.firstName } : {}),
      ...(input.lastName ? { lastName: input.lastName } : {}),
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
    });
    return { id: created.id, source: "created" };
  } catch (err) {
    if (err instanceof Error && err.name === "GhlDuplicateContactError") {
      throw new ContactNeedsReviewError(
        "duplicate_on_create",
        "GHL reports a duplicate contact that could not be matched safely. Review the contacts in GHL.",
      );
    }
    throw err;
  }
}

/**
 * Finds a single exact identifier match and verifies its full record/location.
 * The caller decides whether a match is an approved reuse or a recovery from a
 * previously persisted creation attempt.
 */
export async function findStagedContactMatch(
  api: StagedContactApi,
  input: StagedContactInput,
): Promise<GhlContactLite | null> {
  const email = usableEmail(input.email);
  const phone = usablePhone(input.phone);
  if (!email && !phone) {
    throw new ContactNeedsReviewError(
      "missing_identifier",
      "This customer has no usable email or phone number to match or create a GHL contact.",
    );
  }

  const byEmail = email ? single(await api.lookupByEmail(email), "email") : null;
  const byPhone = phone ? single(await api.lookupByPhone(phone), "phone") : null;
  if (byEmail && byPhone && byEmail.id !== byPhone.id) {
    throw new ContactNeedsReviewError(
      "identifier_conflict",
      "This customer's email and phone number match different GHL contacts.",
    );
  }

  const matched = byEmail ?? byPhone;
  if (!matched) return null;
  const hasConflict = (contact: GhlContactLite) =>
    byEmail && byPhone
      ? hasIdentityConflict(contact, input, "email") ||
        hasIdentityConflict(contact, input, "phone")
      : hasIdentityConflict(contact, input, byEmail ? "email" : "phone");
  if (hasConflict(matched)) {
    throw new ContactNeedsReviewError(
      "identity_conflict",
      "A matching GHL contact has conflicting identity details.",
    );
  }

  const fullContact = await api.getContact(matched.id);
  if (!fullContact) {
    throw new ContactNeedsReviewError(
      "identity_conflict",
      "A matching GHL contact could not be verified. Review the contact before syncing.",
    );
  }
  if (fullContact.locationId !== api.locationId()) {
    throw new ContactNeedsReviewError(
      "wrong_location",
      "A matching GHL contact does not belong to the configured GHL location.",
    );
  }
  if (hasConflict(fullContact)) {
    throw new ContactNeedsReviewError(
      "identity_conflict",
      "A matching GHL contact has conflicting identity details.",
    );
  }
  return fullContact;
}
