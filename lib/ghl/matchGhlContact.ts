import {
  parseEmailStrict,
  parsePhoneStrict,
} from "../imports/customer-identifiers";
import {
  discoverStagedContacts,
  type ContactDiscovery,
  type DiscoveryApi,
  type DiscoveryDeps,
  type DiscoveryInput,
  type DiscoveredContact,
} from "./discoverStagedContacts";
import { stagedContactApi } from "./stagedContactApi";

type ReviewReason =
  | "invalid_email"
  | "invalid_phone"
  | "unsupported_phone"
  | "missing_identifier"
  | "discovery_requires_review"
  | "unverified_location";

export type GhlContactMatchResult =
  | {
      status: "matched";
      contact: DiscoveredContact;
      discovery: ContactDiscovery;
    }
  | { status: "no_match"; discovery: ContactDiscovery }
  | {
      status: "needs_review";
      reason: ReviewReason;
      discovery?: ContactDiscovery;
    };

export type GhlContactMatchingDeps = Pick<
  DiscoveryDeps,
  "findLinkedClients"
> & {
  api?: DiscoveryApi;
};

export async function matchGhlContact(
  deps: GhlContactMatchingDeps,
  input: DiscoveryInput,
  options?: { allowLinkedProfileDifferences?: boolean },
): Promise<GhlContactMatchResult> {
  const email = parseEmailStrict(input.identity.email);
  if (!email.ok) return { status: "needs_review", reason: "invalid_email" };

  const phone = parsePhoneStrict(input.identity.phone);
  if (!phone.ok) return { status: "needs_review", reason: "invalid_phone" };
  if (phone.value && !/^\+1\d{10}$/.test(phone.value)) {
    return { status: "needs_review", reason: "unsupported_phone" };
  }
  if (!email.value && !phone.value && !input.savedContactId) {
    return { status: "needs_review", reason: "missing_identifier" };
  }

  const discovery = await discoverStagedContacts(
    {
      api: deps.api ?? stagedContactApi,
      findLinkedClients: deps.findLinkedClients,
    },
    {
      ...input,
      identity: {
        ...input.identity,
        email: email.value,
        phone: phone.value,
      },
    },
  );

  if (discovery.status === "no_match") {
    return { status: "no_match", discovery };
  }
  const contact = discovery.candidates[0];
  const { identityConflict, ...otherFlags } = discovery.flags;
  const verifiedLinkedProfile =
    options?.allowLinkedProfileDifferences === true &&
    input.savedContactId !== null &&
    input.ownClientId !== null &&
    discovery.savedLink.status === "verified" &&
    discovery.candidates.length === 1 &&
    contact?.id === input.savedContactId &&
    contact.locationVerified &&
    discovery.unsearchable.length === 0 &&
    Object.values(otherFlags).every((flag) => !flag);
  if (
    discovery.status !== "single_match" &&
    !(identityConflict && verifiedLinkedProfile)
  ) {
    return {
      status: "needs_review",
      reason: "discovery_requires_review",
      discovery,
    };
  }

  if (!contact || !contact.locationVerified) {
    return {
      status: "needs_review",
      reason: "unverified_location",
      discovery,
    };
  }

  return { status: "matched", contact, discovery };
}
