import { ghlFetch } from "./client";
import type {
  ContactLookupPage,
  GhlContactLite,
  StagedContactApi,
} from "./resolveStagedContact";

function locationId(): string {
  const id = process.env.GHL_SWINGLOCKER_LOCATION_ID;
  if (!id) throw new Error("Missing GHL_SWINGLOCKER_LOCATION_ID environment variable.");
  return id;
}

// GET /contacts/lookup is an exact match that also covers additional
// emails/phones, paginated with nextCursor. limit=2 is enough to prove the
// match is not unique; a nextCursor (or more than one result) means ambiguous.
// GET /contacts/lookup only accepts `Version: v3`; the default 2021-07-28
// header makes GHL route it as GET /contacts/{id} ("Contact with id lookup not
// found"). Verified read-only against the live location.
async function lookup(param: "email" | "phone", value: string): Promise<ContactLookupPage> {
  const qs = new URLSearchParams({ locationId: locationId(), [param]: value, limit: "2" });
  const res = await ghlFetch<{ contacts?: GhlContactLite[]; nextCursor?: string | null }>(
    `/contacts/lookup?${qs.toString()}`,
    { headers: { Version: "v3" } },
  );
  if (
    !Array.isArray(res?.contacts) ||
    (res.nextCursor !== undefined &&
      res.nextCursor !== null &&
      typeof res.nextCursor !== "string") ||
    res.contacts.some(
      (contact) =>
        !contact ||
        typeof contact !== "object" ||
        typeof contact.id !== "string" ||
        !contact.id.trim() ||
        (contact.locationId != null && typeof contact.locationId !== "string") ||
        (contact.firstName != null && typeof contact.firstName !== "string") ||
        (contact.lastName != null && typeof contact.lastName !== "string") ||
        (contact.email != null && typeof contact.email !== "string") ||
        (contact.phone != null && typeof contact.phone !== "string"),
    )
  ) {
    throw new Error("GHL contact lookup returned an unexpected response.");
  }
  return { contacts: res.contacts, hasMore: Boolean(res.nextCursor) };
}

export const stagedContactApi: StagedContactApi = {
  async getContact(id) {
    try {
      const res = await ghlFetch<{ contact?: GhlContactLite }>(
        `/contacts/${encodeURIComponent(id)}`,
      );
      return res.contact?.id ? res.contact : null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // GHL reports a missing contact as 400 "Contact with id … not found" (404
      // is accepted too); every other failure stays a retryable error.
      if (/GHL API error: (400|404)\b/.test(msg) && /not found/i.test(msg)) return null;
      throw err;
    }
  },
  lookupByEmail: (email) => lookup("email", email),
  lookupByPhone: (phone) => lookup("phone", phone),
  async createContact(input) {
    const res = await ghlFetch<{ contact: { id: string } }>("/contacts", {
      method: "POST",
      body: JSON.stringify({ locationId: locationId(), ...input }),
    });
    return { id: res.contact.id };
  },
  locationId,
};
