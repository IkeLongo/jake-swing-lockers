import { ghlFetch, GhlDuplicateContactError } from "./client";

const LOCATION_ID = () => {
  const id = process.env.GHL_SWINGLOCKER_LOCATION_ID;
  if (!id) throw new Error("Missing GHL_SWINGLOCKER_LOCATION_ID environment variable.");
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

  // GHL rejects `locationId` on PUT contact update — only include it for POST create.
  const updatePayload: Record<string, string> = {};
  if (input.firstName) updatePayload.firstName = input.firstName;
  if (input.lastName) updatePayload.lastName = input.lastName;
  if (input.email) updatePayload.email = input.email;
  if (input.phone) updatePayload.phone = input.phone;

  const createPayload: Record<string, string> = { locationId, ...updatePayload };

  // ── Fast path: we already know the GHL contact ID ────────────────────────
  if (existingGhlContactId) {
    try {
      const res = await ghlFetch<ContactUpdateResponse>(
        `/contacts/${existingGhlContactId}`,
        { method: "PUT", body: JSON.stringify(updatePayload) }
      );
      const id = res.contact.id;
      return { id };
    } catch (err) {
      // If the cached ID is stale (contact deleted in GHL), fall through to
      // email/phone lookup rather than hard-failing.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("404")) {
        console.warn(
          "[GHL Contacts] Cached contact ID not found in GHL, falling back to lookup:",
          existingGhlContactId
        );
        // fall through to email/phone lookup below
      } else {
        throw err;
      }
    }
  }

  // ── Lookup by email ───────────────────────────────────────────────────────
  if (input.email) {
    const found = await lookupContactByEmail(input.email);
    if (found) {
      const res = await ghlFetch<ContactUpdateResponse>(
        `/contacts/${found.id}`,
        { method: "PUT", body: JSON.stringify(updatePayload) }
      );
      return { id: res.contact.id };
    }
  }

  // ── Lookup by phone ───────────────────────────────────────────────────────
  if (input.phone) {
    const found = await lookupContactByPhone(input.phone);
    if (found) {
      const res = await ghlFetch<ContactUpdateResponse>(
        `/contacts/${found.id}`,
        { method: "PUT", body: JSON.stringify(updatePayload) }
      );
      return { id: res.contact.id };
    }
  }

  // ── Create — GHL dedup may reject with an existing contact ID ─────────────
  try {
    const res = await ghlFetch<ContactCreateResponse>("/contacts", {
      method: "POST",
      body: JSON.stringify(createPayload),
    });
    return { id: res.contact.id };
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
