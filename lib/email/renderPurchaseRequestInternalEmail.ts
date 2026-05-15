// ── Types ─────────────────────────────────────────────────────────────────────

import { getAppUrl } from "@/lib/url/getAppBaseUrl";

export interface PurchaseRequestInternalEmailItem {
  clubType: string | null;
  brand: string | null;
  model: string | null;
  estimatedPrice: number | null;
}

export interface RenderPurchaseRequestInternalEmailOptions {
  purchaseRequestId: number;
  demoSessionId: number;
  submittedAt: Date;
  updatedAt?: Date;
  client: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  };
  items: PurchaseRequestInternalEmailItem[];
  estimatedSubtotal: number | null;
  notes: string | null;
  mode?: "submitted" | "updated";
}

export interface RenderedPurchaseRequestInternalEmail {
  subject: string;
  html: string;
  text: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatClubName(item: PurchaseRequestInternalEmailItem): string {
  const parts = [item.brand, item.model].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  return item.clubType ?? "Club";
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function formatDate(date: Date): string {
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Renderer ──────────────────────────────────────────────────────────────────

/**
 * Render a branded internal notification email for a newly submitted purchase request.
 *
 * Intended for delivery to the internal JL Golf Sales team (Jacob).
 * Returns subject, full HTML string, and plain-text fallback.
 * No JavaScript — email-client safe.
 */
export function renderPurchaseRequestInternalEmail(
  options: RenderPurchaseRequestInternalEmailOptions
): RenderedPurchaseRequestInternalEmail {
  const {
    purchaseRequestId,
    demoSessionId,
    submittedAt,
    updatedAt,
    client,
    items,
    estimatedSubtotal,
    notes,
    mode = "submitted",
  } =
    options;
  const adminPath = `/staff/purchase-requests/${purchaseRequestId}`;
  const adminUrl = getAppUrl(adminPath);
  const isUpdated = mode === "updated";

  const clientName =
    [client.firstName, client.lastName].filter(Boolean).join(" ") || "Unknown";

  const subject = isUpdated
    ? `Updated purchase request — ${clientName} (#${purchaseRequestId})`
    : `New purchase request — ${clientName} (#${purchaseRequestId})`;
  const previewText = isUpdated
    ? `${clientName} updated a purchase request with ${items.length} item${items.length !== 1 ? "s" : ""}.`
    : `${clientName} submitted a purchase request with ${items.length} item${items.length !== 1 ? "s" : ""}.`;

  // ── Plain text ─────────────────────────────────────────────────────────────
  const itemLines = items.map((item) => {
    const name = formatClubName(item);
    const price = item.estimatedPrice != null ? ` — ${formatCurrency(item.estimatedPrice)}` : "";
    return `  • ${name}${price}`;
  });

  const text = [
    isUpdated ? "INTERNAL — Updated Purchase Request" : "INTERNAL — New Purchase Request",
    "",
    `Customer:     ${clientName}`,
    `Email:        ${client.email ?? "—"}`,
    `Phone:        ${client.phone ?? "—"}`,
    "",
    `Request #:    ${purchaseRequestId}`,
    `Session #:    ${demoSessionId}`,
    `Submitted:    ${formatDate(submittedAt)}`,
    ...(isUpdated && updatedAt ? [`Updated:      ${formatDate(updatedAt)}`] : []),
    "",
    "Requested Items:",
    ...itemLines,
    ...(estimatedSubtotal != null
      ? ["", `Estimated Total: ${formatCurrency(estimatedSubtotal)}`]
      : []),
    ...(notes ? ["", `Notes: ${notes}`] : []),
    "",
    `Admin: ${adminUrl}`,
    "",
    "— JL Golf Sales (internal notification)",
  ].join("\n");

  // ── HTML ───────────────────────────────────────────────────────────────────
  const itemRows = items
    .map((item) => {
      const name = escapeHtml(formatClubName(item));
      const price =
        item.estimatedPrice != null ? escapeHtml(formatCurrency(item.estimatedPrice)) : "—";
      return `
                  <tr>
                    <td style="padding:10px 12px; border-bottom:1px solid #e5e7eb; font-size:14px; color:#111827;">${name}</td>
                    <td style="padding:10px 12px; border-bottom:1px solid #e5e7eb; font-size:14px; color:#111827; text-align:right; white-space:nowrap;">${price}</td>
                  </tr>`;
    })
    .join("");

  const subtotalRow =
    estimatedSubtotal != null
      ? `
                  <tr>
                    <td style="padding:10px 12px; font-size:14px; font-weight:700; color:#111827;">Estimated Total</td>
                    <td style="padding:10px 12px; font-size:14px; font-weight:700; color:#111827; text-align:right; white-space:nowrap;">${escapeHtml(formatCurrency(estimatedSubtotal))}</td>
                  </tr>`
      : "";

  const notesSection = notes
    ? `
          <!-- ── NOTES ── -->
          <tr>
            <td style="padding:16px 32px 0 32px;">
              <p style="margin:0; font-size:14px; line-height:1.6; color:#374151;">
                <strong>Notes:</strong> ${escapeHtml(notes)}
              </p>
            </td>
          </tr>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${escapeHtml(subject)}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0; padding:0; background-color:#f3f4f6; font-family:Arial, Helvetica, sans-serif;">

  <!-- Preview text (hidden) -->
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">
    ${escapeHtml(previewText)}&nbsp;&#847;&zwnj;&#847;&zwnj;
  </div>

  <!-- Outer wrapper -->
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f3f4f6;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <!-- Card -->
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px; background-color:#ffffff; border-radius:8px; overflow:hidden;">

          <!-- ── HEADER ── -->
          <tr>
            <td align="center" style="padding:24px 20px; background-color:#ffffff;">
              <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto; background-color:#ffffff;">
                <tr>
                  <td align="center" style="background-color:#ffffff; padding:10px 16px;">
                    <img
                      src="https://assets.cdn.filesafe.space/K7Jmh3bFCGbetaJy8jQv/media/6a04f8f0f7d455340c78ebad.png"
                      width="300"
                      style="display:block; margin:0 auto; border:0; outline:none; text-decoration:none;"
                      alt="JL Golf Sales"
                    />
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ── DIVIDER ── -->
          <tr>
            <td style="padding:0 24px;">
              <div style="height:1px; background-color:#e5e7eb;"></div>
            </td>
          </tr>

          <!-- ── LABEL ── -->
          <tr>
            <td style="padding:20px 32px 0 32px;">
              <p style="margin:0; font-size:11px; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:0.08em;">
                Internal Notification
              </p>
            </td>
          </tr>

          <!-- ── TITLE ── -->
          <tr>
            <td style="padding:6px 32px 0 32px;">
              <h1 style="margin:0; font-size:20px; font-weight:700; color:#111827; line-height:1.3;">
                ${isUpdated ? "Updated Purchase Request" : "New Purchase Request"}
              </h1>
            </td>
          </tr>

          <!-- ── CUSTOMER INFO ── -->
          <tr>
            <td style="padding:20px 32px 0 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse; background-color:#f9fafb; border-radius:6px; overflow:hidden;">
                <tr>
                  <td style="padding:10px 14px; font-size:13px; color:#6b7280; font-weight:600; width:80px; vertical-align:top;">Customer</td>
                  <td style="padding:10px 14px; font-size:14px; color:#111827; font-weight:600;">${escapeHtml(clientName)}</td>
                </tr>
                <tr>
                  <td style="padding:4px 14px 10px 14px; font-size:13px; color:#6b7280; font-weight:600; vertical-align:top;">Email</td>
                  <td style="padding:4px 14px 10px 14px; font-size:14px; color:#111827;">${client.email ? escapeHtml(client.email) : "—"}</td>
                </tr>
                <tr>
                  <td style="padding:4px 14px 10px 14px; font-size:13px; color:#6b7280; font-weight:600; vertical-align:top;">Phone</td>
                  <td style="padding:4px 14px 10px 14px; font-size:14px; color:#111827;">${client.phone ? escapeHtml(client.phone) : "—"}</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ── META ── -->
          <tr>
            <td style="padding:16px 32px 0 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr>
                  <td style="padding:3px 16px 3px 0; font-size:13px; color:#6b7280; white-space:nowrap;">Request #</td>
                  <td style="padding:3px 0; font-size:13px; color:#111827; font-weight:600;">${purchaseRequestId}</td>
                </tr>
                <tr>
                  <td style="padding:3px 16px 3px 0; font-size:13px; color:#6b7280; white-space:nowrap;">Demo Session #</td>
                  <td style="padding:3px 0; font-size:13px; color:#111827;">${demoSessionId}</td>
                </tr>
                <tr>
                  <td style="padding:3px 16px 3px 0; font-size:13px; color:#6b7280; white-space:nowrap;">Submitted</td>
                  <td style="padding:3px 0; font-size:13px; color:#111827;">${escapeHtml(formatDate(submittedAt))}</td>
                </tr>
                ${isUpdated && updatedAt
                  ? `<tr>
                  <td style="padding:3px 16px 3px 0; font-size:13px; color:#6b7280; white-space:nowrap;">Updated</td>
                  <td style="padding:3px 0; font-size:13px; color:#111827;">${escapeHtml(formatDate(updatedAt))}</td>
                </tr>`
                  : ""}
              </table>
            </td>
          </tr>

          <!-- ── ITEMS ── -->
          <tr>
            <td style="padding:20px 32px 0 32px;">
              <p style="margin:0 0 10px 0; font-size:12px; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:0.06em;">Requested Items</p>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
                <thead>
                  <tr>
                    <th style="padding:8px 12px; background-color:#f9fafb; border-bottom:2px solid #e5e7eb; font-size:12px; color:#6b7280; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; text-align:left;">Club</th>
                    <th style="padding:8px 12px; background-color:#f9fafb; border-bottom:2px solid #e5e7eb; font-size:12px; color:#6b7280; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; text-align:right;">Est. Price</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemRows}
                  ${subtotalRow}
                </tbody>
              </table>
            </td>
          </tr>

          ${notesSection}

          <!-- ── ADMIN CTA ── -->
          <tr>
            <td align="center" style="padding:20px 32px 0 32px;">
              <a
                href="${escapeHtml(adminUrl)}"
                style="display:inline-block; background-color:#0B0F14; color:#FFFFFF; text-decoration:none; border-radius:8px; padding:14px 22px; font-size:14px; font-weight:600; line-height:1;"
              >
                View Purchase Request
              </a>
            </td>
          </tr>

          <!-- ── ADMIN CTA FALLBACK ── -->
          <tr>
            <td style="padding:12px 32px 8px 32px;">
              <p style="margin:0 0 6px 0; font-size:12px; line-height:1.6; color:#9ca3af; text-align:center;">
                If the button does not work, copy and paste this URL into your browser:
              </p>
              <p style="margin:0; font-size:12px; line-height:1.6; color:#9ca3af; text-align:center; word-break:break-all;">
                <a href="${escapeHtml(adminUrl)}" style="color:#6b7280; text-decoration:underline;">${escapeHtml(adminUrl)}</a>
              </p>
            </td>
          </tr>

          <!-- ── DIVIDER ── -->
          <tr>
            <td style="padding:16px 24px 0 24px;">
              <div style="height:1px; background-color:#e5e7eb;"></div>
            </td>
          </tr>

          <!-- ── FOOTER ── -->
          <tr>
            <td>
              <div style="padding:16px 24px 24px 24px; background-color:#ffffff; font-family:Arial, Helvetica, sans-serif; text-align:center;">
                <p style="margin:0; font-size:12px; line-height:1.6; color:#9ca3af;">
                  JL Golf Sales — Internal notification
                </p>
              </div>
            </td>
          </tr>

        </table>
        <!-- /Card -->

      </td>
    </tr>
  </table>
  <!-- /Outer wrapper -->

</body>
</html>`;

  return { subject, html, text };
}
