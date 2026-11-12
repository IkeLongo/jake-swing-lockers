import { ghlFetch, GhlDuplicateContactError } from "./client";
import {
  ContactDiscoveryUnavailableError,
  discoverStagedContacts,
  type LinkedClientRow,
} from "./discoverStagedContacts";
import { stagedContactApi } from "./stagedContactApi";
import { parseEmailStrict, parsePhoneStrict } from "@/lib/imports/customer-identifiers";
import { normalizeEmail, normalizePhone } from "@/lib/auth/normalize";
import { sameEmail, samePhone } from "./resolveStagedContact";

interface GhlContact {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  [key: string]: unknown;
}

interface ContactUpdateResponse {
  contact: GhlContact;
}

export interface ContactResolution {
  id: string;
  duplicateResolved?: boolean;
  matchingField?: string;
}

export type ContactResolutionErrorCode =
  | "missing_identifier"
  | "invalid_identifier"
  | "lookup_unavailable"
  | "multiple_matches"
  | "identifier_conflict"
  | "identity_conflict"
  | "wrong_location"
  | "location_unverified"
  | "contact_owned_by_another_client"
  | "saved_contact_unavailable"
  | "contact_match_requires_review"
  | "duplicate_on_create";

export class ContactResolutionError extends Error {
  constructor(
    readonly code: ContactResolutionErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ContactResolutionError";
  }
}

export interface ContactUpsertInput {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface ContactUpsertOptions {
  /** Require staff approval before reusing a contact found by identifiers. */
  contactMatchPolicy?: "reuse" | "require-review";
  ownClientId?: number | null;
  findLinkedClients?: (contactIds: string[]) => Promise<LinkedClientRow[]>;
  /** Do not create a contact when the caller has no verified saved link. */
  requireExistingLink?: boolean;
}

function normalizedIdentity(input: ContactUpsertInput) {
  const rawEmail = input.email?.trim() || null;
  const rawPhone = input.phone?.trim() || null;
  const email = rawEmail ? normalizeEmail(rawEmail) : null;
  const phone = rawPhone ? normalizePhone(rawPhone) : null;

  if (rawEmail && !parseEmailStrict(rawEmail).ok) {
    throw new ContactResolutionError(
      "invalid_identifier",
      "The customer email is invalid; correct it before syncing to GHL.",
    );
  }
  if (rawPhone && !parsePhoneStrict(rawPhone).ok) {
    throw new ContactResolutionError(
      "invalid_identifier",
      "The customer phone number is invalid; correct it before syncing to GHL.",
    );
  }
  if (!email && !phone) {
    throw new ContactResolutionError(
      "missing_identifier",
      "A GHL contact requires at least one valid email address or phone number.",
    );
  }

  return {
    firstName: input.firstName?.trim() || null,
    lastName: input.lastName?.trim() || null,
    email,
    phone,
  };
}

function assertDiscoveryUsable(
  discovery: Awaited<ReturnType<typeof discoverStagedContacts>>,
): void {
  if (discovery.unsearchable.length > 0) {
    throw new ContactResolutionError(
      "invalid_identifier",
      `GHL lookup could not search the customer's ${discovery.unsearchable.join(" and ")}. Correct the identifier before syncing.`,
    );
  }
  if (discovery.flags.incomplete || discovery.flags.multipleMatches) {
    throw new ContactResolutionError(
      "multiple_matches",
      "GHL returned multiple or incomplete contact matches. Review the contacts before syncing.",
    );
  }
  if (discovery.flags.identifierConflict) {
    throw new ContactResolutionError(
      "identifier_conflict",
      "The customer's email and phone match different GHL contacts. Review the identity before syncing.",
    );
  }
  if (discovery.flags.wrongLocation) {
    throw new ContactResolutionError(
      "wrong_location",
      "A matching GHL contact belongs to a different location.",
    );
  }
  if (discovery.flags.linkedElsewhere) {
    throw new ContactResolutionError(
      "contact_owned_by_another_client",
      "The matching GHL contact is already linked to another customer. Review the saved contact links before syncing.",
    );
  }
  if (discovery.candidates.some((candidate) => !candidate.locationVerified)) {
    throw new ContactResolutionError(
      "location_unverified",
      "GHL could not verify that every matching contact belongs to the configured location.",
    );
  }
  const identityConflictIsSavedContactUpdate =
    discovery.savedLink.id !== null &&
    discovery.candidates
      .filter((candidate) => candidate.discrepancies.length > 0)
      .every((candidate) => candidate.id === discovery.savedLink.id);
  if (
    discovery.flags.identityConflict &&
    !identityConflictIsSavedContactUpdate
  ) {
    throw new ContactResolutionError(
      "identity_conflict",
      "A matching GHL contact has conflicting identity details. Review the contact before syncing.",
    );
  }
  if (discovery.flags.savedLinkMissing) {
    throw new ContactResolutionError(
      "saved_contact_unavailable",
      "The saved GHL contact link is missing or conflicts with the customer's identifiers. Review the link before syncing.",
    );
  }
  if (
    discovery.savedLink.status === "unverified_location" ||
    (discovery.savedLink.id !== null && discovery.savedLink.status !== "verified")
  ) {
    throw new ContactResolutionError(
      "saved_contact_unavailable",
      "GHL could not verify that the saved contact belongs to the configured location.",
    );
  }
}

export function normalizeContactProfile(input: ContactUpsertInput) {
  return normalizedIdentity(input);
}

async function updateContact(
  contactId: string,
  input: ReturnType<typeof normalizedIdentity>,
): Promise<string> {
  const updatePayload: Record<string, string> = {};
  if (input.firstName) updatePayload.firstName = input.firstName;
  if (input.lastName) updatePayload.lastName = input.lastName;
  if (input.email) updatePayload.email = input.email;
  if (input.phone) updatePayload.phone = input.phone;

  const response = await ghlFetch<ContactUpdateResponse>(
    `/contacts/${encodeURIComponent(contactId)}`,
    { method: "PUT", body: JSON.stringify(updatePayload) },
  );
  if (
    typeof response?.contact?.id !== "string" ||
    response.contact.id !== contactId
  ) {
    throw new Error("GHL contact update returned an unexpected response.");
  }
  return response.contact.id;
}

/** Updates one already-verified contact without searching or creating contacts. */
export async function updateContactProfile(
  contactId: string,
  input: ContactUpsertInput,
): Promise<ContactResolution> {
  const savedContactId = contactId.trim();
  if (!savedContactId) {
    throw new Error("A verified GHL contact ID is required for profile updates.");
  }
  return { id: await updateContact(savedContactId, normalizedIdentity(input)) };
}

/**
 * Resolves a contact using the same v3, exact-identifier discovery used by
 * staged TrackMan imports. A failed or incomplete lookup is never a no-match.
 */
export async function upsertContact(
  input: ContactUpsertInput,
  existingGhlContactId?: string | null,
  options: ContactUpsertOptions = {},
): Promise<ContactResolution> {
  const identity = normalizedIdentity(input);

  const savedContactId = existingGhlContactId?.trim() || null;
  if (options.requireExistingLink && !savedContactId) {
    throw new ContactResolutionError(
      "contact_match_requires_review",
      "This customer has no saved GHL contact. Review and approve a contact through the staged fitting workflow before syncing.",
    );
  }
  let discovery: Awaited<ReturnType<typeof discoverStagedContacts>>;
  try {
    discovery = await discoverStagedContacts(
      {
        api: stagedContactApi,
        findLinkedClients: options.findLinkedClients ?? (async () => []),
      },
      {
        identity,
        savedContactId,
        ownClientId: options.ownClientId ?? null,
      },
    );
  } catch (error) {
    if (error instanceof ContactDiscoveryUnavailableError) {
      throw new ContactResolutionError(
        "lookup_unavailable",
        "GHL contact lookup failed. No contact was created or updated; retry after verifying GHL availability.",
        { cause: error },
      );
    }
    throw error;
  }

  assertDiscoveryUsable(discovery);

  const matches = discovery.candidates.filter(
    (candidate) =>
      candidate.reasons.includes("email") ||
      candidate.reasons.includes("phone"),
  );
  if (savedContactId) {
    if (discovery.savedLink.status !== "verified") {
      throw new ContactResolutionError(
        "saved_contact_unavailable",
        "The saved GHL contact could not be verified. Review the contact link before syncing.",
      );
    }
    if (matches.some((candidate) => candidate.id !== savedContactId)) {
      throw new ContactResolutionError(
        "identifier_conflict",
        "The customer's identifiers match a different GHL contact than the saved link.",
      );
    }
    const savedContact = discovery.candidates.find(
      (candidate) => candidate.id === savedContactId,
    );
    const emailMatches = Boolean(
      identity.email &&
        savedContact?.email &&
        sameEmail(identity.email, savedContact.email),
    );
    const phoneMatches = Boolean(
      identity.phone &&
        savedContact?.phone &&
        samePhone(identity.phone, savedContact.phone),
    );
    if (!savedContact || (!emailMatches && !phoneMatches)) {
      throw new ContactResolutionError(
        "identity_conflict",
        "The saved GHL contact does not match the customer's current email or phone. Review the contact link before syncing.",
      );
    }
    return { id: await updateContact(savedContactId, identity) };
  }

  if (matches.length > 0) {
    if (options.contactMatchPolicy === "require-review") {
      throw new ContactResolutionError(
        "contact_match_requires_review",
        "A GHL contact already matches this email or phone. Review and approve the existing contact before syncing.",
      );
    }
    return { id: await updateContact(matches[0]!.id, identity) };
  }

  try {
    const created = await stagedContactApi.createContact({
      ...(identity.firstName ? { firstName: identity.firstName } : {}),
      ...(identity.lastName ? { lastName: identity.lastName } : {}),
      ...(identity.email ? { email: identity.email } : {}),
      ...(identity.phone ? { phone: identity.phone } : {}),
    });
    if (typeof created?.id !== "string" || !created.id) {
      throw new Error("GHL contact creation returned an unexpected response.");
    }
    return { id: created.id };
  } catch (error) {
    if (error instanceof GhlDuplicateContactError) {
      throw new ContactResolutionError(
        "duplicate_on_create",
        "GHL rejected the new contact as a duplicate. Review the matching contact before retrying.",
        { cause: error },
      );
    }
    throw error;
  }
}

interface CustomFieldValue {
  id: string;
  value: string | string[];
}

export async function updateContactCustomFields(
  ghlContactId: string,
  fields: CustomFieldValue[],
): Promise<void> {
  await ghlFetch<unknown>(`/contacts/${encodeURIComponent(ghlContactId)}`, {
    method: "PUT",
    body: JSON.stringify({ customFields: fields }),
  });
}
