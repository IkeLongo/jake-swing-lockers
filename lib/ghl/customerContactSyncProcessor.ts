import type { PrismaClient } from "@/app/generated/prisma/client";
import { normalizeEmail, normalizePhone } from "@/lib/auth/normalize";
import { GhlApiError, GhlDuplicateContactError } from "./client";
import {
  acknowledgeContactCreation,
  linkVerifiedCustomerContact,
  markContactCreationUncertain,
  rejectContactCreation,
  reserveContactCreation,
  type ContactCreationAttempt,
  type CustomerContactIdentity,
  type VerifiedContactLinkResult,
} from "./customerContactCreationCoordinator";
import {
  claimCustomerSync,
  completeCustomerSync,
  failCustomerSync,
  type CustomerSyncClaim,
  type CustomerSyncFailure,
  type CustomerSyncTransitionResult,
} from "./customerSyncWorkerState";
import type { FittingSyncOwner } from "./fittingSyncClaim";
import {
  ContactDiscoveryUnavailableError,
  type DiscoveredContact,
} from "./discoverStagedContacts";
import { matchGhlContact, type GhlContactMatchResult } from "./matchGhlContact";
import { createStagedContactApi } from "./stagedContactApi";
import {
  normalizeContactProfile,
  updateContactProfile,
} from "./contacts";

const CUSTOMER_SYNC_LEASE_MS = 5 * 60_000;
const RETRY_DELAY_MS = 60_000;
const CUSTOMER_SYNC_GHL_TIMEOUT_MS = 5_000;
const REVIEW_MESSAGE =
  "Customer contact synchronization requires staff review.";

export interface CustomerContactRecord extends CustomerContactIdentity {
  id: number;
  ghlContactId: string | null;
  syncState: {
    workStatus: string;
    desiredVersion: number;
    syncedVersion: number;
  } | null;
}

export type CustomerContactSyncResult =
  | { status: "disabled" }
  | {
      status: "needs_review" | "unavailable" | "needs_reconciliation";
      message?: string;
    }
  | { status: "retry_scheduled"; message: string; retrySafety?: Extract<CustomerSyncFailure, { kind: "retryable" }>["retrySafety"] }
  | { status: "synced"; contactId: string };

export interface CustomerContactSyncServices {
  claim(golfClientId: number): Promise<
    Awaited<ReturnType<typeof claimCustomerSync>>
  >;
  loadCustomer(golfClientId: number): Promise<CustomerContactRecord | null>;
  match(
    customer: CustomerContactRecord,
    savedContactId: string | null,
    options?: { allowLinkedProfileDifferences?: boolean },
  ): Promise<GhlContactMatchResult>;
  link(input: {
    claim: CustomerSyncClaim;
    contactId: string;
    verifiedLocationId: string;
    expectedIdentity: CustomerContactIdentity;
  }): Promise<VerifiedContactLinkResult>;
  reserve(input: {
    golfClientId: number;
    expectedVersion: number;
    workerClaim: CustomerSyncClaim;
  }): ReturnType<typeof reserveContactCreation>;
  createContact(input: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
  }): Promise<{ id: string }>;
  locationId(): string;
  acknowledge(
    attempt: ContactCreationAttempt,
    contactId: string,
  ): ReturnType<typeof acknowledgeContactCreation>;
  reject(
    attempt: ContactCreationAttempt,
    code: string,
    message: string,
  ): ReturnType<typeof rejectContactCreation>;
  markUncertain(
    attempt: ContactCreationAttempt,
    code: string,
    message: string,
  ): ReturnType<typeof markContactCreationUncertain>;
  updateContact(
    contactId: string,
    identity: CustomerContactIdentity,
  ): Promise<{ id: string }>;
  complete(claim: CustomerSyncClaim): Promise<CustomerSyncTransitionResult>;
  fail(
    claim: CustomerSyncClaim,
    failure: CustomerSyncFailure,
  ): Promise<CustomerSyncTransitionResult>;
}

export function isCustomerContactSyncEnabled(): boolean {
  return process.env.GHL_CUSTOMER_CONTACT_SYNC_ENABLED === "true";
}

function createServices(
  database: PrismaClient,
  fittingOwner?: FittingSyncOwner,
): CustomerContactSyncServices {
  const requestSignal = () => AbortSignal.timeout(CUSTOMER_SYNC_GHL_TIMEOUT_MS);
  const stagedContactApi = createStagedContactApi(requestSignal);
  return {
    claim: (golfClientId) =>
      claimCustomerSync(database, golfClientId, CUSTOMER_SYNC_LEASE_MS, fittingOwner),
    loadCustomer: (golfClientId) =>
      database.golfClient.findUnique({
        where: { id: golfClientId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          ghlContactId: true,
          syncState: {
            select: {
              workStatus: true,
              desiredVersion: true,
              syncedVersion: true,
            },
          },
        },
      }),
    match: (customer, savedContactId, options) =>
      matchGhlContact(
        {
          api: stagedContactApi,
          findLinkedClients: (contactIds: string[]) =>
            database.golfClient.findMany({
              where: {
                id: { not: customer.id },
                ghlContactId: { in: contactIds },
              },
              select: {
                id: true,
                firstName: true,
                lastName: true,
                ghlContactId: true,
              },
            }),
        },
        {
          identity: customer,
          savedContactId,
          ownClientId: customer.id,
        },
        options,
      ),
    link: (input) => linkVerifiedCustomerContact(database, input),
    reserve: (input) => reserveContactCreation(database, input),
    createContact: (input) => stagedContactApi.createContact(input),
    locationId: () => stagedContactApi.locationId(),
    acknowledge: (attempt, contactId) =>
      acknowledgeContactCreation(database, attempt, contactId),
    reject: (attempt, code, message) =>
      rejectContactCreation(database, attempt, code, message),
    markUncertain: (attempt, code, message) =>
      markContactCreationUncertain(database, attempt, code, message),
    updateContact: (contactId, identity) =>
      updateContactProfile(contactId, identity, requestSignal()),
    complete: (claim) => completeCustomerSync(database, claim),
    fail: (claim, failure) => failCustomerSync(database, claim, failure),
  };
}

function identityOf(customer: CustomerContactRecord): CustomerContactIdentity {
  return {
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    phone: customer.phone,
  };
}

function isDefinitiveCreationRejection(error: unknown): boolean {
  return (
    error instanceof GhlApiError &&
    [400, 401, 403, 404, 422, 429].includes(error.status)
  );
}

function createdContactMatches(
  contact: DiscoveredContact,
  identity: CustomerContactIdentity,
): boolean {
  const expected = normalizeContactProfile(identity);
  const emailMatches = expected.email !== null &&
    typeof contact.email === "string" &&
    normalizeEmail(contact.email) === expected.email;
  const phoneMatches = expected.phone !== null &&
    typeof contact.phone === "string" &&
    normalizePhone(contact.phone) === expected.phone;

  return (
    (!expected.email || emailMatches) &&
    (!expected.phone || phoneMatches) &&
    (emailMatches || phoneMatches)
  );
}

function reviewReason(result: GhlContactMatchResult): string {
  return result.status === "needs_review"
    ? `GHL contact matching requires review (${result.reason}).`
    : REVIEW_MESSAGE;
}

function transitionResult(
  status: CustomerSyncTransitionResult,
  successStatus: "retry_scheduled" | "needs_review" | "needs_reconciliation",
  message?: string,
): CustomerContactSyncResult {
  if (status.status === "applied") {
    if (successStatus === "retry_scheduled") {
      return {
        status: successStatus,
        message: message ?? "Customer contact sync will be retried.",
      };
    }
    return { status: successStatus, message };
  }
  return status.status === "needs_reconciliation"
    ? { status: "needs_reconciliation" }
    : { status: "unavailable" };
}

async function failClaim(
  services: CustomerContactSyncServices,
  claim: CustomerSyncClaim,
  failure: CustomerSyncFailure,
): Promise<CustomerContactSyncResult> {
  const transition = await services.fail(claim, failure);
  const result = transitionResult(
    transition,
    failure.kind === "retryable"
      ? "retry_scheduled"
      : failure.kind === "review"
        ? "needs_review"
        : "needs_reconciliation",
    failure.message,
  );
  return failure.kind === "retryable" && result.status === "retry_scheduled"
    ? { ...result, retrySafety: failure.retrySafety }
    : result;
}

async function verifyLinkedContact(
  services: CustomerContactSyncServices,
  claim: CustomerSyncClaim,
  customer: CustomerContactRecord,
  match: Extract<GhlContactMatchResult, { status: "matched" }>,
): Promise<"ready" | "deferred" | CustomerContactSyncResult> {
  if (!match.contact.locationVerified) {
    return failClaim(services, claim, {
      kind: "review",
      code: "ghl_contact_location_unverified",
      message: `GHL contact ${match.contact.id} does not have a verified location.`,
    });
  }
  const link = await services.link({
    claim,
    contactId: match.contact.id,
    verifiedLocationId: services.locationId(),
    expectedIdentity: identityOf(customer),
  });
  if (link.status === "linked" || link.status === "already_linked") {
    return "ready";
  }
  if (link.status === "version_changed") {
    const completed = await services.complete(claim);
    return completed.status === "applied"
      ? "deferred"
      : { status: "unavailable" };
  }
  if (link.status === "lost_claim") return { status: "unavailable" };
  const reconciliation =
    link.status === "attempt_unresolved" ||
    link.status === "customer_missing";
  return failClaim(services, claim, {
    kind: reconciliation ? "reconciliation" : "review",
    code: reconciliation ? "contact_link_unresolved" : "contact_link_conflict",
    message: `Verified GHL contact ${match.contact.id} could not be linked (${link.status}).`,
  });
}

async function markCreationUncertain(
  services: CustomerContactSyncServices,
  attempt: ContactCreationAttempt,
  code: string,
  message: string,
): Promise<CustomerContactSyncResult> {
  try {
    const transition = await services.markUncertain(attempt, code, message);
    if (transition.status === "applied" || transition.status === "needs_reconciliation") {
      return { status: "needs_reconciliation", message };
    }
    return {
      status: "needs_reconciliation",
      message: `${message} The attempt transition returned ${transition.status}.`,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      status: "needs_reconciliation",
      message: `Contact creation reconciliation transition failed: ${detail}`,
    };
  }
}

async function syncClaimedCustomer(
  services: CustomerContactSyncServices,
  claim: CustomerSyncClaim,
  customer: CustomerContactRecord,
): Promise<CustomerContactSyncResult> {
  let match: GhlContactMatchResult;
  try {
    match = await services.match(customer, customer.ghlContactId, {
      allowLinkedProfileDifferences: customer.ghlContactId !== null,
    });
  } catch (error) {
    if (error instanceof ContactDiscoveryUnavailableError) {
      return failClaim(services, claim, {
        kind: "retryable",
        retrySafety: "no_remote_write",
        delayMs: RETRY_DELAY_MS,
        code: "ghl_lookup_unavailable",
        message: "GHL contact lookup failed before any contact write; retry is safe.",
      });
    }
    const detail = error instanceof Error ? error.message : String(error);
    return failClaim(services, claim, {
      kind: "reconciliation",
      code: "ghl_lookup_unexpected",
      message: `GHL matching failed unexpectedly: ${detail}`,
    });
  }

  if (match.status === "needs_review") {
    return failClaim(services, claim, {
      kind: "review",
      code: "ghl_match_review",
      message: reviewReason(match),
    });
  }

  let contactId: string;
  if (match.status === "matched") {
    if (!customer.ghlContactId) {
      return failClaim(services, claim, {
        kind: "review",
        code: "unlinked_ghl_contact_match",
        message: "An existing GHL contact matches this unlinked customer. Staff review is required before linking.",
      });
    }
    const linkResult = await verifyLinkedContact(services, claim, customer, match);
    if (linkResult !== "ready") {
      return linkResult === "deferred"
        ? { status: "unavailable" }
        : linkResult;
    }
    contactId = match.contact.id;
  } else {
    const reservation = await services.reserve({
      golfClientId: customer.id,
      expectedVersion: claim.version,
      workerClaim: claim,
    });
    if (reservation.status === "blocked") {
      if (reservation.reason === "version_changed") {
        const completed = await services.complete(claim);
        return completed.status === "applied"
          ? { status: "unavailable", message: "A newer customer profile is pending synchronization." }
          : { status: "unavailable" };
      }
      return failClaim(services, claim, {
        kind: "reconciliation",
        code: "contact_creation_reservation_blocked",
        message: `GHL contact creation was blocked (${reservation.reason}).`,
      });
    }
    if (reservation.status === "linked") {
      let linkedMatch: GhlContactMatchResult;
      try {
        linkedMatch = await services.match(customer, reservation.contactId);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return failClaim(services, claim, {
          kind: "reconciliation",
          code: "linked_contact_verification_failed",
          message: `A concurrent contact link was found but could not be verified: ${detail}`,
        });
      }
      if (
        linkedMatch.status !== "matched" ||
        linkedMatch.contact.id !== reservation.contactId
      ) {
        return failClaim(services, claim, {
          kind: "review",
          code: "linked_contact_requires_review",
          message: "A concurrent contact link could not be verified against the current customer identity.",
        });
      }
      const linkResult = await verifyLinkedContact(
        services,
        claim,
        customer,
        linkedMatch,
      );
      if (linkResult !== "ready") {
        return linkResult === "deferred"
          ? { status: "unavailable" }
          : linkResult;
      }
      contactId = reservation.contactId;
    } else {
      let createdId: string;
      const identity = normalizeContactProfile(identityOf(customer));
      try {
        const created = await services.createContact({
          ...(identity.firstName ? { firstName: identity.firstName } : {}),
          ...(identity.lastName ? { lastName: identity.lastName } : {}),
          ...(identity.email ? { email: identity.email } : {}),
          ...(identity.phone ? { phone: identity.phone } : {}),
        });
        if (typeof created?.id !== "string" || !created.id.trim()) {
          return markCreationUncertain(
            services,
            reservation.attempt,
            "ghl_contact_create_invalid_response",
            "GHL contact creation returned an invalid response; the remote result is uncertain.",
          );
        }
        createdId = created.id;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          error instanceof GhlDuplicateContactError ||
          isDefinitiveCreationRejection(error)
        ) {
          try {
            const rejected = await services.reject(
              reservation.attempt,
              error instanceof GhlDuplicateContactError
                ? "duplicate_contact"
                : "ghl_rejected",
              message,
            );
            return rejected.status === "applied"
              ? { status: "needs_review" }
              : { status: "needs_reconciliation" };
          } catch (transitionError) {
            const detail =
              transitionError instanceof Error
                ? transitionError.message
                : String(transitionError);
            return markCreationUncertain(
              services,
              reservation.attempt,
              "ghl_contact_rejection_unrecorded",
              `GHL rejected contact creation but the rejection could not be recorded: ${detail}`,
            );
          }
        }
        return markCreationUncertain(
          services,
          reservation.attempt,
          "ghl_contact_create_uncertain",
          `GHL contact creation returned an uncertain result: ${message}`,
        );
      }

      let verifiedMatch: GhlContactMatchResult;
      try {
        verifiedMatch = await services.match(customer, createdId);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return markCreationUncertain(
          services,
          reservation.attempt,
          "ghl_contact_verification_uncertain",
          `Created contact ${createdId}, but matching and verification failed: ${detail}`,
        );
      }
      if (
        verifiedMatch.status !== "matched" ||
        verifiedMatch.contact.id !== createdId ||
        !verifiedMatch.contact.locationVerified ||
        !createdContactMatches(verifiedMatch.contact, identity)
      ) {
        return markCreationUncertain(
          services,
          reservation.attempt,
          "ghl_contact_verification_uncertain",
          `Created contact ${createdId} did not pass location, identity, and ownership verification.`,
        );
      }

      if (verifiedMatch.contact.linkedClients.length > 0) {
        return markCreationUncertain(
          services,
          reservation.attempt,
          "ghl_contact_ownership_conflict",
          `Created contact ${createdId} is already linked to another local customer.`,
        );
      }

      let acknowledged: Awaited<
        ReturnType<CustomerContactSyncServices["acknowledge"]>
      >;
      try {
        acknowledged = await services.acknowledge(
          reservation.attempt,
          createdId,
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return markCreationUncertain(
          services,
          reservation.attempt,
          "ghl_contact_acknowledgment_uncertain",
          `Created and verified contact ${createdId}, but local acknowledgment failed: ${detail}`,
        );
      }
      if (acknowledged.status !== "applied") {
        return markCreationUncertain(
          services,
          reservation.attempt,
          "ghl_contact_acknowledgment_conflict",
          `Created and verified contact ${createdId}, but acknowledgment returned ${acknowledged.status}.`,
        );
      }

      const linkResult = await services.link({
        claim,
        contactId: createdId,
        verifiedLocationId: services.locationId(),
        expectedIdentity: identityOf(customer),
      });
      if (linkResult.status !== "linked" && linkResult.status !== "already_linked") {
        if (linkResult.status === "version_changed") {
          const completed = await services.complete(claim);
          return completed.status === "applied"
            ? { status: "unavailable" }
            : { status: "needs_reconciliation" };
        }
        return failClaim(services, claim, {
          kind: "reconciliation",
          code: "ghl_contact_link_verification_failed",
          message: `Created contact ${createdId} was acknowledged but verification metadata could not be saved (${linkResult.status}).`,
        });
      }
      contactId = createdId;
    }
  }

  try {
    const updated = await services.updateContact(contactId, identityOf(customer));
    if (updated.id !== contactId) {
      return failClaim(services, claim, {
        kind: "reconciliation",
        code: "ghl_contact_update_mismatch",
        message: "GHL profile update returned a different contact ID.",
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      error instanceof GhlDuplicateContactError ||
      (error instanceof GhlApiError &&
        [400, 401, 403, 404, 422].includes(error.status))
    ) {
      return failClaim(services, claim, {
        kind: "review",
        code: "ghl_contact_update_rejected",
        message: `GHL rejected the verified contact profile update: ${message}`,
      });
    }
    // Reapplying this same desired-state PUT is safe; it cannot create a contact.
    return failClaim(services, claim, {
      kind: "retryable",
      retrySafety: "idempotent_update",
      delayMs: RETRY_DELAY_MS,
      code: "ghl_contact_update_retryable",
      message: `The same desired profile can be safely retried using an idempotent contact update: ${message}`,
    });
  }

  const completed = await services.complete(claim);
  if (completed.status === "applied") {
    return { status: "synced", contactId };
  }
  return completed.status === "needs_reconciliation"
    ? { status: "needs_reconciliation" }
    : { status: "unavailable" };
}

async function returnVerifiedSyncedContact(
  services: CustomerContactSyncServices,
  customer: CustomerContactRecord | null,
): Promise<CustomerContactSyncResult> {
  if (
    !customer ||
    customer.syncState?.workStatus !== "synced" ||
    customer.syncState.desiredVersion !== customer.syncState.syncedVersion ||
    !customer.ghlContactId
  ) {
    return { status: "unavailable" };
  }
  try {
    const match = await services.match(customer, customer.ghlContactId);
    if (
      match.status === "matched" &&
      match.contact.id === customer.ghlContactId
    ) {
      return { status: "synced", contactId: customer.ghlContactId };
    }
    return {
      status: "needs_review",
      message: "The saved GHL contact no longer verifies against the customer.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "unavailable", message };
  }
}

export async function processCustomerContactSync(
  golfClientId: number,
  suppliedServices?: CustomerContactSyncServices,
  fittingOwner?: FittingSyncOwner,
): Promise<CustomerContactSyncResult> {
  if (!Number.isSafeInteger(golfClientId) || golfClientId < 1) {
    throw new RangeError("golfClientId must be a positive safe integer.");
  }
  if (!isCustomerContactSyncEnabled()) return { status: "disabled" };

  const services = suppliedServices ?? createServices(
    (await import("@/lib/db")).db,
    fittingOwner,
  );
  const claimResult = await services.claim(golfClientId);
  if (claimResult.status === "fitting_blocked") {
    return { status: "unavailable", message: "A fitting sync or unresolved fitting state blocks customer synchronization." };
  }
  if (claimResult.status === "needs_reconciliation") {
    return { status: "needs_reconciliation" };
  }
  if (claimResult.status === "unavailable") {
    return returnVerifiedSyncedContact(
      services,
      await services.loadCustomer(golfClientId),
    );
  }

  const customer = await services.loadCustomer(golfClientId);
  if (!customer) {
    return failClaim(services, claimResult.claim, {
      kind: "review",
      code: "customer_missing",
      message: `GolfClient ${golfClientId} was not found after claiming customer sync.`,
    });
  }
  return syncClaimedCustomer(services, claimResult.claim, customer);
}
