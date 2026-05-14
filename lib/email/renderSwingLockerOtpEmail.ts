// ── Types ─────────────────────────────────────────────────────────────────────

export interface RenderSwingLockerOtpEmailOptions {
  code: string;
  firstName?: string | null;
  previewText?: string;
}

export interface RenderedOtpEmail {
  subject: string;
  html: string;
  text: string;
}

// ── Renderer ──────────────────────────────────────────────────────────────────

/**
 * Render a branded transactional OTP email for Swing Locker.
 *
 * Returns subject, full HTML string, and plain-text fallback.
 * No JavaScript — email-client safe.
 * OTP code is never stored; only the composed final message is returned.
 */
export function renderSwingLockerOtpEmail(
  options: RenderSwingLockerOtpEmailOptions
): RenderedOtpEmail {
  const { code, firstName, previewText = "Your Swing Locker verification code" } = options;

  const greeting = firstName ? `Hi ${firstName},` : "Hi,";

  const subject = "Your Swing Locker verification code";

  // Plain-text fallback for email clients that don't render HTML
  const text = [
    greeting,
    "",
    "Use the verification code below to finish signing in to your Swing Locker account.",
    "",
    `Your code: ${code}`,
    "",
    "Copy and paste this code to finish signing in.",
    "",
    "This code expires in 10 minutes.",
    "",
    "If you did not request this code, you can safely ignore this email.",
    "",
    "— JL Golf Sales",
  ].join("\n");

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
                ${greeting}
              </p>

              <p style="margin:0 0 24px 0; font-size:15px; line-height:1.6; color:#374151;">
                Use the verification code below to finish signing in to your Swing Locker account.
              </p>

              <!-- OTP Code block -->
              <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 24px auto;">
                <tr>
                  <td align="center" style="background-color:#f9fafb; border:2px solid #e5e7eb; border-radius:8px; padding:20px 40px;">
                    <span style="display:block; font-size:36px; font-weight:700; letter-spacing:10px; color:#111827; font-family:Courier New, Courier, monospace; line-height:1;">
                      ${code}
                    </span>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 16px 0; font-size:14px; line-height:1.6; color:#6b7280; text-align:center;">
                Copy and paste this code to finish signing in.
              </p>

              <p style="margin:0 0 8px 0; font-size:14px; line-height:1.6; color:#6b7280;">
                This code expires in <strong>10 minutes</strong>.
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
                  This code was requested to sign in to your Swing Locker account.
                </p>
                <p style="margin:0 0 8px 0; font-size:12px; line-height:1.6; color:#6b7280;">
                  If you did not request this code, you can safely ignore this email.
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

</body>
</html>`;

  return { subject, html, text };
}
