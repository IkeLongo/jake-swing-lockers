import { db } from "@/lib/db";
import { ghlFetch } from "./client";
import { syncGolfClientContact } from "./syncGolfClientContact";
import { upsertContact } from "./contacts";
import { getPurchaseRequestDetail } from "@/lib/queries/purchase-requests";
import { renderPurchaseRequestCustomerEmail } from "@/lib/email/renderPurchaseRequestCustomerEmail";
import { renderPurchaseRequestInternalEmail } from "@/lib/email/renderPurchaseRequestInternalEmail";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DeliverPurchaseRequestEmailsResult {
  customerDelivered: boolean;
  internalDelivered: boolean;
  customerError?: string;
  internalError?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getLocationId(): string {
  const id = process.env.GHL_SWINGLOCKER_LOCATION_ID;
  if (!id) throw new Error("Missing GHL_SWINGLOCKER_LOCATION_ID environment variable.");
  return id;
}

function getInternalNotifyEmail(): string {
  const email = process.env.GHL_SWINGLOCKER_INTERNAL_ADMIN_NOTIFY_EMAIL;
  if (!email)
    throw new Error(
      "Missing GHL_SWINGLOCKER_INTERNAL_ADMIN_NOTIFY_EMAIL environment variable."
    );
  return email;
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

/**
 * Deliver purchase request confirmation emails for a newly submitted request.
 *
 * Sends two emails via the Swing Locker GHL subaccount:
 *   1. Customer confirmation — to the submitting GolfClient's email address.
 *   2. Internal notification — to GHL_SWINGLOCKER_INTERNAL_ADMIN_NOTIFY_EMAIL.
 *
 * Each delivery is wrapped independently in try/catch. Failure of one does not
 * prevent the other. Neither failure propagates to the caller — purchase request
 * creation always succeeds regardless of email delivery outcome.
 *
 * Returns a result summary suitable for logging.
 */
export async function deliverPurchaseRequestEmails(
  purchaseRequestId: number
): Promise<DeliverPurchaseRequestEmailsResult> {
  const result: DeliverPurchaseRequestEmailsResult = {
    customerDelivered: false,
    internalDelivered: false,
  };

  // ── Load full request detail ───────────────────────────────────────────────
  const detail = await getPurchaseRequestDetail(purchaseRequestId);
  if (!detail) {
    console.error(
      `[deliverPurchaseRequestEmails] Purchase request #${purchaseRequestId} not found — skipping email delivery.`
    );
    return result;
  }

  const locationId = getLocationId();

  const emailItems = detail.items.map((item) => ({
    clubType: item.clubType,
    brand: item.brand,
    model: item.model,
    estimatedPrice: item.estimatedPrice,
  }));

  // ── 1. Customer confirmation email ────────────────────────────────────────
  if (detail.client.email) {
    try {
      // Sync/upsert the GHL contact so we have a contactId
      await syncGolfClientContact(detail.golfClientId);

      const synced = await db.golfClient.findUnique({
        where: { id: detail.golfClientId },
        select: { ghlContactId: true },
      });

      if (!synced?.ghlContactId) {
        throw new Error(
          `GHL contact could not be resolved for golfClientId=${detail.golfClientId}`
        );
      }

      const { subject, html, text } = renderPurchaseRequestCustomerEmail({
        firstName: detail.client.firstName,
        items: emailItems,
        estimatedSubtotal: detail.estimatedSubtotal,
        notes: detail.notes,
      });

      await ghlFetch<unknown>("/conversations/messages", {
        method: "POST",
        body: JSON.stringify({
          type: "Email",
          contactId: synced.ghlContactId,
          locationId,
          subject,
          html,
          message: text,
          emailTo: detail.client.email,
        }),
      });

      result.customerDelivered = true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(
        `[deliverPurchaseRequestEmails] Customer email failed for request #${purchaseRequestId}:`,
        errorMessage
      );
      result.customerError = errorMessage;
    }
  } else {
    console.warn(
      `[deliverPurchaseRequestEmails] Skipping customer email — no email address on golfClientId=${detail.golfClientId}.`
    );
  }

  // ── 2. Internal notification email ────────────────────────────────────────
  try {
    const internalEmail = getInternalNotifyEmail();

    // Look up or create a GHL contact for the internal recipient.
    // This uses GET /contacts/lookup by email first, then POST /contacts if not found.
    // No contact ID is hardcoded — the lookup is fully dynamic.
    const contactResolution = await upsertContact({ email: internalEmail });

    const { subject, html, text } = renderPurchaseRequestInternalEmail({
      purchaseRequestId: detail.id,
      demoSessionId: detail.demoSessionId,
      submittedAt: detail.createdAt,
      client: detail.client,
      items: emailItems,
      estimatedSubtotal: detail.estimatedSubtotal,
      notes: detail.notes,
    });

    await ghlFetch<unknown>("/conversations/messages", {
      method: "POST",
      body: JSON.stringify({
        type: "Email",
        contactId: contactResolution.id,
        locationId,
        subject,
        html,
        message: text,
        emailTo: internalEmail,
      }),
    });

    result.internalDelivered = true;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(
      `[deliverPurchaseRequestEmails] Internal email failed for request #${purchaseRequestId}:`,
      errorMessage
    );
    result.internalError = errorMessage;
  }

  return result;
}
