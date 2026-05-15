// ── Types ─────────────────────────────────────────────────────────────────────

export interface PurchaseRequestCustomerEmailItem {
  clubType: string | null;
  brand: string | null;
  model: string | null;
  estimatedPrice: number | null;
}

export interface RenderPurchaseRequestCustomerEmailOptions {
  firstName: string | null;
  items: PurchaseRequestCustomerEmailItem[];
  estimatedSubtotal: number | null;
  notes: string | null;
  mode?: "submitted" | "updated";
}

export interface RenderedPurchaseRequestCustomerEmail {
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

function formatClubName(item: PurchaseRequestCustomerEmailItem): string {
  const parts = [item.brand, item.model].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  return item.clubType ?? "Club";
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

// ── Renderer ──────────────────────────────────────────────────────────────────

/**
 * Render a branded confirmation email for a customer's submitted purchase request.
 *
 * Returns subject, full HTML string, and plain-text fallback.
 * No JavaScript — email-client safe.
 */
export function renderPurchaseRequestCustomerEmail(
  options: RenderPurchaseRequestCustomerEmailOptions
): RenderedPurchaseRequestCustomerEmail {
  const { firstName, items, estimatedSubtotal, notes, mode = "submitted" } = options;

  const greeting = firstName ? `Hi ${firstName},` : "Hi,";
  const isUpdated = mode === "updated";
  const subject = isUpdated
    ? "Your Swing Locker purchase request has been updated"
    : "Your Swing Locker purchase request has been submitted";
  const previewText = isUpdated
    ? "Your purchase request has been updated by JL Golf Sales."
    : "Your purchase interest request has been received by JL Golf Sales.";

  // ── Plain text ─────────────────────────────────────────────────────────────
  const itemLines = items.map((item) => {
    const name = formatClubName(item);
    const price = item.estimatedPrice != null ? ` — ${formatCurrency(item.estimatedPrice)}` : "";
    return `  • ${name}${price}`;
  });

  const text = [
    greeting,
    "",
    isUpdated
      ? "Your purchase request has been updated by JL Golf Sales. The latest request details are included below."
      : "Thank you for submitting your purchase interest through Swing Locker. Your request has been received and forwarded to JL Golf Sales for review.",
    "",
    "Requested Items:",
    ...itemLines,
    ...(estimatedSubtotal != null
      ? ["", `Estimated Total: ${formatCurrency(estimatedSubtotal)}`]
      : []),
    ...(notes ? ["", `Notes: ${notes}`] : []),
    "",
    "Jacob from JL Golf Sales may reach out with additional details or next steps.",
    "",
    "You can revisit your Swing Locker dashboard at any time to review your session results.",
    "",
    "— JL Golf Sales",
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
              <p style="margin:20px 0 0 0; font-size:14px; line-height:1.6; color:#374151;">
                <strong>Notes:</strong> ${escapeHtml(notes)}
              </p>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${subject}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0; padding:0; background-color:#f3f4f6; font-family:Arial, Helvetica, sans-serif;">

  <!-- Preview text (hidden) -->
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">
    ${previewText}&nbsp;&#847;&zwnj;&#847;&zwnj;
  </div>

  <!-- Outer wrapper -->
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f3f4f6;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <!-- Card -->
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:520px; background-color:#ffffff; border-radius:8px; overflow:hidden;">

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

          <!-- ── BODY ── -->
          <tr>
            <td style="padding:32px 32px 24px 32px;">

              <p style="margin:0 0 16px 0; font-size:16px; line-height:1.6; color:#111827;">
                ${escapeHtml(greeting)}
              </p>

              <p style="margin:0 0 24px 0; font-size:15px; line-height:1.6; color:#374151;">
                ${isUpdated
                  ? "Your purchase request has been updated by JL Golf Sales. The latest request details are included below."
                  : "Thank you for submitting your purchase interest through Swing Locker. Your request has been received and forwarded to JL Golf Sales for review."}
              </p>

              <!-- Items table -->
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

              ${notesSection}

              <p style="margin:24px 0 12px 0; font-size:14px; line-height:1.6; color:#374151;">
                Jacob from JL Golf Sales may reach out with additional details or next steps.
              </p>

              <p style="margin:0; font-size:14px; line-height:1.6; color:#6b7280;">
                You can revisit your Swing Locker dashboard at any time to review your session results.
              </p>

            </td>
          </tr>

          <!-- ── DIVIDER ── -->
          <tr>
            <td style="padding:0 24px;">
              <div style="height:1px; background-color:#e5e7eb;"></div>
            </td>
          </tr>

          <!-- ── FOOTER ── -->
          <tr>
            <td>
              <div style="padding:24px 24px 32px 24px; background-color:#ffffff; font-family:Arial, Helvetica, sans-serif; text-align:center;">
                <p style="margin:0 0 8px 0; font-size:12px; line-height:1.6; color:#6b7280;">
                  You received this email because you submitted a purchase interest request through your Swing Locker account.
                </p>
                <p style="margin:16px 0 0 0; font-size:12px; line-height:1.6; color:#9ca3af;">
                  JL Golf Sales
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
