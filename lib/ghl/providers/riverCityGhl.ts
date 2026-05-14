import { makeGhlFetch, GhlDuplicateContactError } from "../client";

// ── Credentials ───────────────────────────────────────────────────────────────

function getToken(): string {
  const token = process.env.GHL_RIVERCITY_PRIVATE_TOKEN;
  if (!token) throw new Error("Missing GHL_RIVERCITY_PRIVATE_TOKEN environment variable.");
  return token;
}

function getLocationId(): string {
  const id = process.env.GHL_RIVERCITY_LOCATION_ID;
  if (!id) throw new Error("Missing GHL_RIVERCITY_LOCATION_ID environment variable.");
  return id;
}

// ── Types (minimal) ───────────────────────────────────────────────────────────

interface RcContact {
  id: string;
  [key: string]: unknown;
}

interface ContactLookupResponse {
  contacts: RcContact[];
}

interface ContactCreateResponse {
  contact: RcContact;
}

// ── Contact upsert ────────────────────────────────────────────────────────────

export interface RiverCityContactInput {
  firstName?: string | null;
  lastName?: string | null;
  phone: string;
}

/**
 * Find or create a temporary RiverCity contact by phone.
 *
 * RiverCity contacts are temporary SMS transport contacts only.
 * Their IDs are NOT stored on GolfClient — they are not CRM source-of-truth.
 *
 * Resolution: lookup by phone → create (with duplicate fallback).
 */
export async function upsertRiverCityContact(
  input: RiverCityContactInput
): Promise<string> {
  const fetch = makeGhlFetch(getToken());
  const locationId = getLocationId();

  // ── Lookup by phone ───────────────────────────────────────────────────────
  const params = new URLSearchParams({ locationId, phone: input.phone });
  try {
    const res = await fetch<ContactLookupResponse>(
      `/contacts/lookup?${params.toString()}`
    );
    const found = res.contacts?.[0];
    if (found) return found.id;
  } catch {
    // lookup unavailable — fall through to create
  }

  // ── Create ────────────────────────────────────────────────────────────────
  const payload: Record<string, string> = { locationId, phone: input.phone };
  if (input.firstName) payload.firstName = input.firstName;
  if (input.lastName) payload.lastName = input.lastName;

  try {
    const res = await fetch<ContactCreateResponse>("/contacts", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return res.contact.id;
  } catch (err) {
    if (err instanceof GhlDuplicateContactError) return err.contactId;
    throw err;
  }
}

// ── Tag helper ────────────────────────────────────────────────────────────────

/**
 * Apply tags to a RiverCity contact.
 * Used to mark temporary SMS transport contacts for future bulk cleanup.
 */
export async function addRiverCityTags(
  contactId: string,
  tags: string[]
): Promise<void> {
  const fetch = makeGhlFetch(getToken());
  await fetch<unknown>(`/contacts/${contactId}/tags`, {
    method: "POST",
    body: JSON.stringify({ tags }),
  });
}

// ── SMS delivery ──────────────────────────────────────────────────────────────

/**
 * Send a direct SMS through the RiverCity GHL Conversations API.
 *
 * GHL auto-creates a conversation if none exists for the contact.
 * locationId is included as some GHL subaccounts require it for outbound routing.
 *
 * Do NOT pass OTP plaintext to any other GHL endpoint — only here, composed
 * as the final message string.
 */
export async function sendRiverCitySms(
  contactId: string,
  message: string
): Promise<void> {
  const fetch = makeGhlFetch(getToken());
  const locationId = getLocationId();

  await fetch<unknown>("/conversations/messages", {
    method: "POST",
    body: JSON.stringify({
      type: "SMS",
      contactId,
      message,
      locationId,
    }),
  });
}
