import { sameEmail, samePhone } from "./resolveStagedContact";
import type {
  ContactDiscovery,
  DiscoveredContact,
} from "./discoverStagedContacts";

// Presentation-only comparison of the local customer against a discovered GHL
// contact. It reuses the resolver's equality rules and never decides anything;
// a missing value is never a match, and an invalid (wrong-location) contact
// never gets a "match" indicator.

export interface ComparableCustomer {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}

export interface Indicator {
  tone: "match" | "warn";
  label: string;
}

const present = (v: string | null | undefined): v is string => Boolean(v?.trim());

export function candidateIndicators(
  local: ComparableCustomer,
  candidate: DiscoveredContact,
): Indicator[] {
  const out: Indicator[] = [];

  if (candidate.wrongLocation) {
    out.push({ tone: "warn", label: "Belongs to a different GHL location" });
  } else {
    if (present(local.email) && present(candidate.email)) {
      out.push(
        sameEmail(local.email, candidate.email)
          ? { tone: "match", label: "Email matches" }
          : { tone: "warn", label: "Email addresses differ" },
      );
    }
    if (present(local.phone) && present(candidate.phone)) {
      out.push(
        samePhone(local.phone, candidate.phone)
          ? { tone: "match", label: "Phone number matches" }
          : { tone: "warn", label: "Phone numbers differ" },
      );
    }
    if (
      candidate.discrepancies.includes("firstName") ||
      candidate.discrepancies.includes("lastName")
    ) {
      out.push({ tone: "warn", label: "Name differs" });
    }
  }

  for (const linked of candidate.linkedClients) {
    out.push({
      tone: "warn",
      label: `Already linked to ${linked.name} (#${linked.id})`,
    });
  }
  return out;
}

export function candidateNeedsReview(
  discovery: ContactDiscovery,
  candidate: DiscoveredContact,
): boolean {
  const f = discovery.flags;
  return (
    f.multipleMatches ||
    f.identifierConflict ||
    f.incomplete ||
    f.savedLinkMismatch ||
    candidate.wrongLocation ||
    candidate.discrepancies.length > 0 ||
    candidate.linkedClients.length > 0
  );
}

/** Notices that are not tied to a single candidate. */
export function discoveryNotices(discovery: ContactDiscovery): string[] {
  const f = discovery.flags;
  const out: string[] = [];
  if (f.identifierConflict) out.push("Email and phone match different GHL contacts.");
  if (f.multipleMatches) out.push("More than one GHL contact matches.");
  if (f.incomplete) out.push("GHL returned partial results, so this list may be incomplete.");
  if (f.savedLinkMissing) out.push("The saved GHL contact no longer exists in GHL.");
  if (f.savedLinkMismatch) out.push("Other contacts match besides the saved GHL contact.");
  if (discovery.savedLink.status === "wrong_location") {
    out.push("The saved GHL contact belongs to a different GHL location.");
  }
  if (discovery.savedLink.status === "unverified_location") {
    out.push("GHL did not confirm the location of the saved GHL contact.");
  }
  if (discovery.unsearchable.length > 0) {
    out.push(
      `${discovery.unsearchable.join(" and ")} not searched (not in a searchable format).`,
    );
  }
  return out;
}
