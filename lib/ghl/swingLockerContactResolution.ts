import {
  ContactResolutionError,
  upsertContact,
} from "./contacts";
import type { LinkedClientRow } from "./discoverStagedContacts";

export interface SwingLockerCustomerContact {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  ghlContactId: string | null;
}

export async function resolveSwingLockerCustomerContact(
  client: SwingLockerCustomerContact,
  findLinkedClients: (contactIds: string[]) => Promise<LinkedClientRow[]>,
): Promise<string> {
  if (!client.ghlContactId) {
    throw new ContactResolutionError(
      "contact_match_requires_review",
      "This customer has no verified GHL contact link. Resolve and approve a GHL contact through the customer review workflow before sending Swing Locker access.",
    );
  }

  const resolution = await upsertContact(
    {
      firstName: client.firstName,
      lastName: client.lastName,
      email: client.email,
      phone: client.phone,
    },
    client.ghlContactId,
    {
      contactMatchPolicy: "require-review",
      ownClientId: client.id,
      findLinkedClients,
    },
  );
  if (resolution.id !== client.ghlContactId) {
    throw new ContactResolutionError(
      "saved_contact_unavailable",
      "Contact resolution returned a different GHL contact than the customer's verified link. Review the link before sending access.",
    );
  }
  return resolution.id;
}
