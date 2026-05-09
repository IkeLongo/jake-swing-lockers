import { ghlFetch, GhlDuplicateContactError } from "./client";

const LOCATION_ID = () => {
  const id = process.env.GHL_LOCATION_ID;
  if (!id) throw new Error("Missing GHL_LOCATION_ID environment variable.");
  return id;
};

// ── GHL Contact shapes (minimal) ─────────────────────────────────────────────

interface GhlContact {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  [key: string]: unknown;
}

interface ContactLookupResponse {
  contacts: GhlContact[];
}

interface ContactCreateResponse {
  contact: GhlContact;
}

interface ContactUpdateResponse {
  contact: GhlContact;
}

// ── Resolution result ─────────────────────────────────────────────────────────

export interface ContactResolution {
  id: string;
  duplicateResolved?: boolean;
  matchingField?: string;
}

// ── Lookup helpers ────────────────────────────────────────────────────────────
// GHL v2 does NOT support GET /contacts/search — it routes that as
// GET /contacts/{id} where id="search".
// The correct exact-match lookup endpoint is GET /contacts/lookup.

async function lookupContactByEmail(
  email: string
): Promise<GhlContact | null> {
  console.log("[GHL Contacts] Searching by email:", email);
  const params = new URLSearchParams({
    locationId: LOCATION_ID(),
    email,
  });
  try {
    const res = await ghlFetch<ContactLookupResponse>(
      `/contacts/lookup?${params.toString()}`
    );
    return res.contacts?.[0] ?? null;
  } catch {
    // If lookup endpoint is unavailable, fall through to create
    return null;
  }
}

async function lookupContactByPhone(
  phone: string
): Promise<GhlContact | null> {
  console.log("[GHL Contacts] Searching by phone:", phone);
  const params = new URLSearchParams({
    locationId: LOCATION_ID(),
    phone,
  });
  try {
    const res = await ghlFetch<ContactLookupResponse>(
      `/contacts/lookup?${params.toString()}`
    );
    return res.contacts?.[0] ?? null;
  } catch {
    return null;
  }
}

// ── Upsert (create or update) ─────────────────────────────────────────────────

export interface ContactUpsertInput {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
}

/**
 * Find or create a GHL contact.
 *
 * Resolution order:
 *   1. If `existingGhlContactId` is set, update that contact directly.
 *   2. Look up by email via GET /contacts/lookup.
 *   3. Look up by phone via GET /contacts/lookup.
 *   4. If still not found, POST /contacts.
 *      — If GHL rejects with a duplicate-contact error, extract the existing
 *        contact ID from the error body instead of throwing.
 *
 * Returns a ContactResolution with the resolved ID and duplicate metadata.
 */
export async function upsertContact(
  input: ContactUpsertInput,
  existingGhlContactId?: string | null
): Promise<ContactResolution> {
  const locationId = LOCATION_ID();

  const payload: Record<string, string> = { locationId };
  if (input.firstName) payload.firstName = input.firstName;
  if (input.lastName) payload.lastName = input.lastName;
  if (input.email) payload.email = input.email;
  if (input.phone) payload.phone = input.phone;

  // ── Fast path: we already know the GHL contact ID ────────────────────────
  if (existingGhlContactId) {
    console.log("[GHL Contacts] Updating known contact:", existingGhlContactId);
    const res = await ghlFetch<ContactUpdateResponse>(
      `/contacts/${existingGhlContactId}`,
      { method: "PUT", body: JSON.stringify(payload) }
    );
    const id = res.contact.id;
    console.log("[GHL Contacts] Contact resolved:", id);
    return { id };
  }

  // ── Lookup by email ───────────────────────────────────────────────────────
  if (input.email) {
    const found = await lookupContactByEmail(input.email);
    if (found) {
      console.log("[GHL Contacts] Found contact by email, updating:", found.id);
      const res = await ghlFetch<ContactUpdateResponse>(
        `/contacts/${found.id}`,
        { method: "PUT", body: JSON.stringify(payload) }
      );
      const id = res.contact.id;
      console.log("[GHL Contacts] Contact resolved:", id);
      return { id };
    }
  }

  // ── Lookup by phone ───────────────────────────────────────────────────────
  if (input.phone) {
    const found = await lookupContactByPhone(input.phone);
    if (found) {
      console.log("[GHL Contacts] Found contact by phone, updating:", found.id);
      const res = await ghlFetch<ContactUpdateResponse>(
        `/contacts/${found.id}`,
        { method: "PUT", body: JSON.stringify(payload) }
      );
      const id = res.contact.id;
      console.log("[GHL Contacts] Contact resolved:", id);
      return { id };
    }
  }

  // ── Create — GHL dedup may reject with an existing contact ID ─────────────
  console.log("[GHL Contacts] No contact found — creating/upserting contact");
  try {
    const res = await ghlFetch<ContactCreateResponse>("/contacts", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const id = res.contact.id;
    console.log("[GHL Contacts] Contact resolved:", id);
    return { id };
  } catch (err) {
    if (err instanceof GhlDuplicateContactError) {
      console.log("[GHL Contacts] Duplicate resolved using existing contact", {
        contactId: err.contactId,
        matchingField: err.matchingField,
      });
      return {
        id: err.contactId,
        duplicateResolved: true,
        matchingField: err.matchingField,
      };
    }
    throw err;
  }
}

// ── Custom fields ─────────────────────────────────────────────────────────────

interface CustomFieldValue {
  id: string;
  value: string | string[];
}

export async function updateContactCustomFields(
  ghlContactId: string,
  fields: CustomFieldValue[]
): Promise<void> {
  await ghlFetch<unknown>(`/contacts/${ghlContactId}`, {
    method: "PUT",
    body: JSON.stringify({ customFields: fields }),
  });
}

// ── Upsert (create or update) ─────────────────────────────────────────────────

export interface ContactUpsertInput {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
}

// ── Custom fields ─────────────────────────────────────────────────────────────

interface CustomFieldValue {
  id: string;
  value: string | string[];
}
