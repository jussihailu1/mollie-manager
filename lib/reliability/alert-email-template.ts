type AlertEmailLink = {
  label: string;
  path: string;
  url: string;
};

export type AlertEmailContext = {
  alertId: string;
  createdAt: string;
  customerEmail: string | null;
  customerId: string | null;
  customerName: string | null;
  message: string;
  mode: "live" | "test" | null;
  paymentAmountCurrency: string | null;
  paymentAmountValue: string | null;
  paymentId: string | null;
  paymentMollieId: string | null;
  paymentStatus: string | null;
  severity: "critical" | "warning" | "info";
  subscriptionId: string | null;
  subscriptionLocalStatus: string | null;
  subscriptionMollieId: string | null;
  subscriptionStatus: string | null;
  title: string;
};

export type AlertEmailContent = {
  html: string;
  primaryUrl: string;
  relatedLinks: AlertEmailLink[];
  text: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return null;
  }

  return timestamp.toISOString().replace("T", " ").replace(".000Z", " UTC");
}

function formatCurrency(value: string | null, currency: string | null) {
  if (!value || !currency) {
    return null;
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return `${currency} ${value}`;
  }

  try {
    return new Intl.NumberFormat("en-US", {
      currency,
      style: "currency",
    }).format(numericValue);
  } catch {
    return `${currency} ${value}`;
  }
}

function toAbsoluteUrl(path: string, appUrl: string) {
  try {
    return new URL(path, appUrl).toString();
  } catch {
    return path;
  }
}

function buildLinks(context: AlertEmailContext, appUrl: string) {
  const paymentPath = context.paymentId
    ? `/payments?focus=${encodeURIComponent(context.paymentId)}`
    : null;
  const customerPath = context.customerId
    ? `/customers?focus=${encodeURIComponent(context.customerId)}`
    : null;
  const notificationsPath = "/notifications";

  const orderedLinks = [
    paymentPath
      ? {
          label: "View payment",
          path: paymentPath,
        }
      : null,
    customerPath
      ? {
          label: "View customer",
          path: customerPath,
        }
      : null,
    {
      label: "Open notifications",
      path: notificationsPath,
    },
  ].filter((item): item is { label: string; path: string } => item !== null);

  const deduped = orderedLinks.filter(
    (link, index) => orderedLinks.findIndex((item) => item.path === link.path) === index,
  );
  const primary = deduped[0] ?? {
    label: "Open notifications",
    path: notificationsPath,
  };
  const primaryUrl = toAbsoluteUrl(primary.path, appUrl);
  const relatedLinks = deduped.slice(1).map((link) => ({
    label: link.label,
    path: link.path,
    url: toAbsoluteUrl(link.path, appUrl),
  }));

  return {
    primaryUrl,
    relatedLinks,
  };
}

function buildSafeDetails(context: AlertEmailContext) {
  const details: Array<{ label: string; value: string }> = [];
  const amount = formatCurrency(context.paymentAmountValue, context.paymentAmountCurrency);

  const pairs: Array<[string, string | null]> = [
    ["Alert ID", context.alertId],
    ["Severity", context.severity],
    ["Created at", formatTimestamp(context.createdAt)],
    ["Mollie mode", context.mode],
    ["Customer", context.customerName],
    ["Customer email", context.customerEmail],
    ["Customer ID", context.customerId],
    ["Payment ID", context.paymentId],
    ["Mollie payment ID", context.paymentMollieId],
    ["Payment status", context.paymentStatus],
    ["Payment amount", amount],
    ["Subscription ID", context.subscriptionId],
    ["Mollie subscription ID", context.subscriptionMollieId],
    ["Subscription status", context.subscriptionStatus],
    ["Subscription local status", context.subscriptionLocalStatus],
  ];

  for (const [label, value] of pairs) {
    if (value && value.trim().length > 0) {
      details.push({
        label,
        value,
      });
    }
  }

  return details;
}

export function buildAlertEmailContent(
  context: AlertEmailContext,
  appUrl: string,
): AlertEmailContent {
  const links = buildLinks(context, appUrl);
  const safeDetails = buildSafeDetails(context);
  const safeMessage = escapeHtml(context.message);
  const safeTitle = escapeHtml(context.title);
  const safeRelatedLinks = links.relatedLinks
    .map(
      (link) =>
        `<li style="margin: 0 0 6px 0;"><a href="${escapeHtml(link.url)}" style="color: #3b2a1f; text-decoration: underline;">${escapeHtml(link.label)}</a></li>`,
    )
    .join("");
  const safeDetailsHtml = safeDetails
    .map(
      (detail) =>
        `<tr><td style="padding: 6px 10px 6px 0; color: #4a4a4a; vertical-align: top;">${escapeHtml(detail.label)}</td><td style="padding: 6px 0; color: #111111; vertical-align: top; font-weight: 600;">${escapeHtml(detail.value)}</td></tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin: 0; padding: 24px; background: #f5f5f5; font-family: Arial, Helvetica, sans-serif; color: #111111;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 620px; background: #ffffff; border-radius: 10px; border: 1px solid #e7e7e7;">
            <tr>
              <td style="padding: 20px 22px 8px 22px;">
                <div style="font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #6d6d6d;">Kify</div>
                <div style="font-size: 21px; font-weight: 700; margin-top: 4px;">Mollie Manager</div>
              </td>
            </tr>
            <tr>
              <td style="padding: 0 22px;">
                <h1 style="font-size: 22px; margin: 10px 0 8px 0; line-height: 1.3;">${safeTitle}</h1>
                <p style="margin: 0 0 18px 0; color: #2f2f2f; line-height: 1.5;">${safeMessage}</p>
                <a href="${escapeHtml(links.primaryUrl)}" style="display: inline-block; padding: 11px 16px; background: #3b2a1f; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600;">Open in Mollie Manager</a>
              </td>
            </tr>
            ${
              safeRelatedLinks
                ? `<tr>
              <td style="padding: 18px 22px 0 22px;">
                <h2 style="margin: 0 0 8px 0; font-size: 15px;">Related links</h2>
                <ul style="margin: 0; padding-left: 18px; color: #3b2a1f;">
                  ${safeRelatedLinks}
                </ul>
              </td>
            </tr>`
                : ""
            }
            <tr>
              <td style="padding: 18px 22px 6px 22px;">
                <h2 style="margin: 0 0 8px 0; font-size: 15px;">Safe details</h2>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  ${safeDetailsHtml}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 22px 22px 22px; color: #666666; font-size: 12px; line-height: 1.4;">
                This email includes operational details only and excludes secrets, tokens, and payment credentials.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const detailLines = safeDetails.map((detail) => `${detail.label}: ${detail.value}`);
  const relatedLines = links.relatedLinks.map((link) => `${link.label}: ${link.url}`);
  const text = [
    "Kify | Mollie Manager",
    "",
    `Title: ${context.title}`,
    `Reason: ${context.message}`,
    "",
    `Open in Mollie Manager: ${links.primaryUrl}`,
    ...(relatedLines.length > 0 ? ["", "Related links:", ...relatedLines] : []),
    "",
    "Safe details:",
    ...detailLines,
    "",
    "This email includes operational details only and excludes secrets, tokens, and payment credentials.",
  ].join("\n");

  return {
    html,
    primaryUrl: links.primaryUrl,
    relatedLinks: links.relatedLinks,
    text,
  };
}

export function buildFallbackAlertEmailContent(input: {
  message: string;
  title: string;
}) {
  const context: AlertEmailContext = {
    alertId: "unknown",
    createdAt: new Date().toISOString(),
    customerEmail: null,
    customerId: null,
    customerName: null,
    message: input.message,
    mode: null,
    paymentAmountCurrency: null,
    paymentAmountValue: null,
    paymentId: null,
    paymentMollieId: null,
    paymentStatus: null,
    severity: "warning",
    subscriptionId: null,
    subscriptionLocalStatus: null,
    subscriptionMollieId: null,
    subscriptionStatus: null,
    title: input.title,
  };

  return buildAlertEmailContent(context, "http://localhost:3000");
}
