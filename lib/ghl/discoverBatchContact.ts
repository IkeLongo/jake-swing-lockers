import { parseProposedIdentity } from "@/lib/imports/customer-identifiers";
import { hasPersistedCustomerResolution } from "@/lib/imports/customer-workflow-routing";
import {
  isReviewBlocking,
  type ClientIdentity,
} from "@/lib/imports/new-customer-review";
import { buildNewCustomerReview } from "@/lib/imports/new-customer-review-server";
import {
  discoverStagedContacts,
  type ContactDiscovery,
  type DiscoveryDeps,
  type DiscoveryInput,
} from "./discoverStagedContacts";

// Resolves the identifiers for GHL discovery strictly from persisted state
// (the ImportBatch, or the selected GolfClient). Nothing identifying comes
// from the request, and nothing is written.

export interface DiscoveryBatchRow {
  id: number;
  parserMode: string;
  demoSessionId: number | null;
  customerResolution: string | null;
  selectedGolfClientId: number | null;
  proposedFirstName: string | null;
  proposedLastName: string | null;
  proposedEmail: string | null;
  proposedPhone: string | null;
  newCustomerConfirmationSignature: string | null;
}

export interface DiscoveryClientRow {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  ghlContactId: string | null;
}

export interface BatchDiscoveryDeps extends DiscoveryDeps {
  loadBatch(batchId: number): Promise<DiscoveryBatchRow | null>;
  loadClient(clientId: number): Promise<DiscoveryClientRow | null>;
  loadDuplicateClients(): Promise<ClientIdentity[]>;
}

export interface DiscoveryLocalCustomer {
  id: number | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}

export type BatchDiscoveryResult =
  | {
      ok: true;
      customer: "existing" | "new";
      localCustomer: DiscoveryLocalCustomer;
      /**
       * GolfClient.ghlContactId exactly as persisted (untrimmed). Discovery
       * matches on the trimmed value; compare-and-set writes must use this.
       */
      persistedSavedContactId: string | null;
      discovery: ContactDiscovery;
    }
  | { ok: false; httpStatus: 404 | 409; code: string; error: string };

const fail = (
  httpStatus: 404 | 409,
  code: string,
  error: string,
): BatchDiscoveryResult => ({ ok: false, httpStatus, code, error });

export async function discoverContactForBatch(
  deps: BatchDiscoveryDeps,
  batchId: number,
): Promise<BatchDiscoveryResult> {
  const batch = await deps.loadBatch(batchId);
  if (!batch) return fail(404, "batch_not_found", "Import batch not found.");
  if (batch.parserMode !== "trackman-result" || batch.demoSessionId !== null) {
    return fail(
      409,
      "not_stageable",
      "GHL discovery is only available for unlinked TrackMan imports.",
    );
  }
  if (!hasPersistedCustomerResolution(batch)) {
    return fail(
      409,
      "customer_unresolved",
      "Save the customer before looking up GHL contacts.",
    );
  }

  let input: DiscoveryInput;
  let customer: "existing" | "new";
  let persistedSavedContactId: string | null = null;
  if (batch.customerResolution === "existing") {
    const client = await deps.loadClient(batch.selectedGolfClientId!);
    if (!client) {
      return fail(409, "customer_unresolved", "The selected customer no longer exists.");
    }
    customer = "existing";
    persistedSavedContactId = client.ghlContactId;
    input = {
      identity: {
        firstName: client.firstName,
        lastName: client.lastName,
        email: client.email,
        phone: client.phone,
      },
      savedContactId: client.ghlContactId?.trim() || null,
      ownClientId: client.id,
    };
  } else {
    const identity = parseProposedIdentity({
      firstName: batch.proposedFirstName,
      lastName: batch.proposedLastName,
      email: batch.proposedEmail,
      phone: batch.proposedPhone,
    });
    if (!identity.ok) {
      return fail(409, "customer_unresolved", identity.error);
    }
    const review = buildNewCustomerReview(
      await deps.loadDuplicateClients(),
      { email: identity.value.email, phone: identity.value.phone },
      batch.newCustomerConfirmationSignature,
    );
    if (isReviewBlocking(review)) {
      return fail(
        409,
        "local_review_required",
        "Resolve the matching local customers before looking up GHL contacts.",
      );
    }
    customer = "new";
    input = { identity: identity.value, savedContactId: null, ownClientId: null };
  }

  return {
    ok: true,
    customer,
    localCustomer: {
      id: input.ownClientId,
      firstName: input.identity.firstName,
      lastName: input.identity.lastName,
      email: input.identity.email,
      phone: input.identity.phone,
    },
    persistedSavedContactId,
    discovery: await discoverStagedContacts(deps, input),
  };
}
