import {
  conflicts,
  sameEmail,
  samePhone,
  usableEmail,
  usablePhone,
  type GhlContactLite,
  type StagedContactApi,
  type StagedContactInput,
} from "./resolveStagedContact";

// Read-only GHL contact discovery for the staged Customer step.
//
// Shares the identifier normalization and identity-conflict rules of
// resolveStagedContact, but never creates, links, or modifies anything and
// never picks a contact: it reports every candidate and every reason staff
// should review. A failed or truncated lookup is never reported as "no match".

export type DiscoveryApi = Pick<
  StagedContactApi,
  "getContact" | "lookupByEmail" | "lookupByPhone" | "locationId"
>;

export interface LinkedClientRow {
  id: number;
  firstName: string | null;
  lastName: string | null;
  ghlContactId: string | null;
}

export interface DiscoveryDeps {
  api: DiscoveryApi;
  /** Local GolfClients whose saved ghlContactId is one of `contactIds`. */
  findLinkedClients(contactIds: string[]): Promise<LinkedClientRow[]>;
}

export interface DiscoveryInput {
  identity: StagedContactInput;
  /** The selected GolfClient's saved ghlContactId, if any. */
  savedContactId: string | null;
  /** The selected GolfClient, excluded from "linked to another customer". */
  ownClientId: number | null;
}

export type DiscoveryMatchReason = "saved_link" | "email" | "phone";
export type IdentityDiscrepancy = "email" | "phone" | "firstName" | "lastName";

export interface LinkedClient {
  id: number;
  name: string;
}

export interface DiscoveredContact {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  reasons: DiscoveryMatchReason[];
  /** Fields where the contact holds a different, non-empty value. */
  discrepancies: IdentityDiscrepancy[];
  wrongLocation: boolean;
  /**
   * True only when GHL reported this contact's locationId and it equals the
   * configured location. A missing locationId is never treated as verified.
   */
  locationVerified: boolean;
  /** Other local GolfClients already linked to this contact. */
  linkedClients: LinkedClient[];
}

/**
 * "unverified_location": the saved contact exists in GHL but GHL did not report
 * a location for it, so the association is not positively verified.
 */
export type SavedLinkStatus =
  | "none"
  | "verified"
  | "unverified_location"
  | "missing"
  | "wrong_location";

export interface DiscoveryFlags {
  multipleMatches: boolean;
  identifierConflict: boolean;
  identityConflict: boolean;
  wrongLocation: boolean;
  linkedElsewhere: boolean;
  /** A lookup reported more results than it returned. */
  incomplete: boolean;
  savedLinkMissing: boolean;
  savedLinkMismatch: boolean;
}

export type DiscoveryStatus =
  | "no_identifier"
  | "no_match"
  | "single_match"
  | "needs_review";

export interface ContactDiscovery {
  status: DiscoveryStatus;
  searched: { email: boolean; phone: boolean };
  /** Identifiers present but not usable for an exact GHL lookup. */
  unsearchable: ("email" | "phone")[];
  savedLink: { id: string | null; status: SavedLinkStatus };
  candidates: DiscoveredContact[];
  flags: DiscoveryFlags;
}

/** Any lookup failure. Distinct from an empty (no-match) result. */
export class ContactDiscoveryUnavailableError extends Error {
  readonly code = "ghl-unavailable" as const;
  constructor(cause: unknown) {
    super("GHL contact lookup is unavailable.", { cause });
    this.name = "ContactDiscoveryUnavailableError";
  }
}

const text = (v: string | null | undefined) => v?.trim() || null;

function clientName(c: LinkedClientRow): string {
  return (
    [c.firstName, c.lastName].filter(Boolean).join(" ") || `Customer #${c.id}`
  );
}

function discrepanciesFor(
  contact: GhlContactLite,
  identity: StagedContactInput,
  reasons: ReadonlySet<DiscoveryMatchReason>,
): IdentityDiscrepancy[] {
  const found: IdentityDiscrepancy[] = [];
  // An identifier that produced the match cannot conflict with itself.
  if (!reasons.has("email") && conflicts(identity.email, contact.email, sameEmail)) {
    found.push("email");
  }
  if (!reasons.has("phone") && conflicts(identity.phone, contact.phone, samePhone)) {
    found.push("phone");
  }
  if (conflicts(identity.firstName, contact.firstName)) found.push("firstName");
  if (conflicts(identity.lastName, contact.lastName)) found.push("lastName");
  return found;
}

interface Lookup {
  ids: string[];
  hasMore: boolean;
}

export async function discoverStagedContacts(
  deps: DiscoveryDeps,
  input: DiscoveryInput,
): Promise<ContactDiscovery> {
  const { api } = deps;
  const { identity } = input;
  const email = usableEmail(identity.email);
  const phone = usablePhone(identity.phone);
  const unsearchable: ("email" | "phone")[] = [];
  if (identity.email?.trim() && !email) unsearchable.push("email");
  if (identity.phone?.trim() && !phone) unsearchable.push("phone");

  const contacts = new Map<string, GhlContactLite>();
  const reasons = new Map<string, Set<DiscoveryMatchReason>>();
  const addReason = (contact: GhlContactLite, reason: DiscoveryMatchReason) => {
    contacts.set(contact.id, contact);
    const set = reasons.get(contact.id) ?? new Set<DiscoveryMatchReason>();
    set.add(reason);
    reasons.set(contact.id, set);
  };

  const emptyLookup: Lookup = { ids: [], hasMore: false };
  const runLookup = async (
    lookupFn: (() => ReturnType<DiscoveryApi["lookupByEmail"]>) | null,
    reason: "email" | "phone",
  ): Promise<Lookup> => {
    if (!lookupFn) return emptyLookup;
    const page = await lookupFn();
    const found = page.contacts.filter((c) => c && c.id);
    for (const contact of found) addReason(contact, reason);
    return {
      ids: [...new Set(found.map((c) => c.id))],
      hasMore: page.hasMore,
    };
  };

  let byEmail = emptyLookup;
  let byPhone = emptyLookup;
  let savedLinkStatus: SavedLinkStatus = "none";
  let linked: LinkedClientRow[] = [];

  try {
    const saved = input.savedContactId
      ? await api.getContact(input.savedContactId)
      : null;
    if (input.savedContactId) {
      if (!saved) {
        savedLinkStatus = "missing";
      } else {
        savedLinkStatus = !saved.locationId
          ? "unverified_location"
          : saved.locationId !== api.locationId()
            ? "wrong_location"
            : "verified";
        addReason(saved, "saved_link");
      }
    }

    [byEmail, byPhone] = await Promise.all([
      runLookup(email ? () => api.lookupByEmail(email) : null, "email"),
      runLookup(phone ? () => api.lookupByPhone(phone) : null, "phone"),
    ]);

    // Lookup results may omit locationId; read the full record (GET) instead of
    // assuming the contact belongs to this location.
    const fullRecordRead = new Set(
      input.savedContactId && saved ? [saved.id] : [],
    );
    await Promise.all(
      [...contacts.values()]
        .filter((c) => !c.locationId && !fullRecordRead.has(c.id))
        .map(async (c) => {
          const full = await api.getContact(c.id);
          if (full?.locationId) {
            contacts.set(c.id, { ...c, locationId: full.locationId });
          }
        }),
    );

    if (contacts.size > 0) {
      linked = await deps.findLinkedClients([...contacts.keys()]);
    }
  } catch (err) {
    throw new ContactDiscoveryUnavailableError(err);
  }

  const linkedByContact = new Map<string, LinkedClient[]>();
  for (const row of linked) {
    if (!row.ghlContactId || row.id === input.ownClientId) continue;
    const list = linkedByContact.get(row.ghlContactId) ?? [];
    list.push({ id: row.id, name: clientName(row) });
    linkedByContact.set(row.ghlContactId, list);
  }

  const expectedLocation = api.locationId();
  const candidates: DiscoveredContact[] = [...contacts.values()].map((contact) => {
    const contactReasons = reasons.get(contact.id)!;
    return {
      id: contact.id,
      firstName: text(contact.firstName),
      lastName: text(contact.lastName),
      email: text(contact.email),
      phone: text(contact.phone),
      reasons: (["saved_link", "email", "phone"] as const).filter((r) =>
        contactReasons.has(r),
      ),
      discrepancies: discrepanciesFor(contact, identity, contactReasons),
      wrongLocation:
        Boolean(contact.locationId) && contact.locationId !== expectedLocation,
      locationVerified: contact.locationId === expectedLocation,
      linkedClients: linkedByContact.get(contact.id) ?? [],
    };
  });

  const emailIds = new Set(byEmail.ids);
  const identifierConflict =
    byEmail.ids.length > 0 &&
    byPhone.ids.length > 0 &&
    !byPhone.ids.some((id) => emailIds.has(id));

  const savedVerified =
    savedLinkStatus === "verified" || savedLinkStatus === "unverified_location"
      ? input.savedContactId
      : null;
  const flags: DiscoveryFlags = {
    multipleMatches: byEmail.ids.length > 1 || byPhone.ids.length > 1,
    identifierConflict,
    identityConflict: candidates.some((c) => c.discrepancies.length > 0),
    wrongLocation: candidates.some((c) => c.wrongLocation),
    linkedElsewhere: candidates.some((c) => c.linkedClients.length > 0),
    incomplete: byEmail.hasMore || byPhone.hasMore,
    savedLinkMissing: savedLinkStatus === "missing",
    savedLinkMismatch:
      savedVerified !== null && candidates.some((c) => c.id !== savedVerified),
  };

  const searched = { email: email !== null, phone: phone !== null };
  const anyFlag = Object.values(flags).some(Boolean);

  let status: DiscoveryStatus;
  if (!searched.email && !searched.phone && candidates.length === 0 && !anyFlag) {
    status = "no_identifier";
  } else if (candidates.length === 0 && !anyFlag) {
    status = "no_match";
  } else if (candidates.length === 1 && !anyFlag) {
    status = "single_match";
  } else {
    status = "needs_review";
  }

  return {
    status,
    searched,
    unsearchable,
    savedLink: { id: input.savedContactId, status: savedLinkStatus },
    candidates,
    flags,
  };
}
