import type {
  PaymentOutcomeClassification,
  PaymentOutcomeState,
} from "@/lib/payment-outcome-classification";

export type FailedPaymentCustomerEmailInput = {
  amountCurrency?: string | null;
  amountValue?: string | null;
  contactEmail?: string | null;
  customerName?: string | null;
  invoiceNumber?: string | null;
  outcome: PaymentOutcomeClassification;
  plannedCollectionDate?: string | null;
};

export type FailedPaymentCustomerEmail =
  | {
      reason: "not_customer_notifiable";
      shouldSend: false;
    }
  | {
      html: string;
      reason: "customer_notifiable";
      shouldSend: true;
      subject: string;
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

function formatAmount(value: string | null | undefined, currency: string | null | undefined) {
  if (!value || !currency) {
    return null;
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return `${currency} ${value}`;
  }

  try {
    return new Intl.NumberFormat("nl-NL", {
      currency,
      style: "currency",
    }).format(numericValue);
  } catch {
    return `${currency} ${value}`;
  }
}

function subjectForState(state: PaymentOutcomeState) {
  if (state === "mandate_problem") {
    return "Betaling instellen vraagt aandacht";
  }

  if (state === "charged_back" || state === "reversed") {
    return "Betaling is teruggedraaid";
  }

  if (state === "needs_review") {
    return "Betaling vraagt aandacht";
  }

  return "Betaling is niet gelukt";
}

function explanationForState(state: PaymentOutcomeState) {
  if (state === "mandate_problem") {
    return "De betaalmachtiging of betaalrekening lijkt niet bruikbaar voor deze betaling.";
  }

  if (state === "charged_back") {
    return "De betaling is teruggeboekt via de bank.";
  }

  if (state === "reversed") {
    return "De betaling is teruggedraaid nadat deze eerder was verwerkt.";
  }

  if (state === "needs_review") {
    return "De betaling heeft na de verwachte verwerkingstijd nog geen definitieve geslaagde status.";
  }

  return "De betaling is niet geslaagd.";
}

function buildReferenceLines(input: FailedPaymentCustomerEmailInput) {
  const amount = formatAmount(input.amountValue, input.amountCurrency);
  return [
    input.invoiceNumber ? `Factuur: ${input.invoiceNumber}` : null,
    amount ? `Bedrag: ${amount}` : null,
    input.plannedCollectionDate
      ? `Geplande betaaldatum: ${input.plannedCollectionDate}`
      : null,
  ].filter((line): line is string => line !== null);
}

export function buildFailedPaymentCustomerEmail(
  input: FailedPaymentCustomerEmailInput,
): FailedPaymentCustomerEmail {
  if (!input.outcome.customerNotificationAllowed) {
    return {
      reason: "not_customer_notifiable",
      shouldSend: false,
    };
  }

  const greeting = input.customerName?.trim()
    ? `Beste ${input.customerName.trim()},`
    : "Beste klant,";
  const explanation = explanationForState(input.outcome.state);
  const subject = subjectForState(input.outcome.state);
  const referenceLines = buildReferenceLines(input);
  const contactLine = input.contactEmail
    ? `Neem contact met ons op via ${input.contactEmail} als u vragen heeft of de betaling wilt afstemmen.`
    : "Neem contact met ons op als u vragen heeft of de betaling wilt afstemmen.";
  const obligationLine =
    "De factuur of betalingsverplichting kan hierdoor nog openstaan.";
  const reviewLine =
    "Wij controleren de betaling en nemen zo nodig contact op over de veilige vervolgstap.";

  const text = [
    greeting,
    "",
    explanation,
    obligationLine,
    "",
    ...(referenceLines.length > 0 ? [...referenceLines, ""] : []),
    reviewLine,
    contactLine,
    "",
    "Met vriendelijke groet,",
    "Kify",
  ].join("\n");

  const safeReferenceHtml = referenceLines
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("");
  const html = `<!doctype html>
<html lang="nl">
  <body style="margin: 0; padding: 24px; background: #f7f7f7; font-family: Arial, Helvetica, sans-serif; color: #111111;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 620px; background: #ffffff; border: 1px solid #e5e5e5; border-radius: 8px;">
            <tr>
              <td style="padding: 22px;">
                <p style="margin: 0 0 14px 0;">${escapeHtml(greeting)}</p>
                <p style="margin: 0 0 12px 0; line-height: 1.5;">${escapeHtml(explanation)}</p>
                <p style="margin: 0 0 16px 0; line-height: 1.5;">${escapeHtml(obligationLine)}</p>
                ${
                  safeReferenceHtml
                    ? `<ul style="margin: 0 0 16px 18px; padding: 0;">${safeReferenceHtml}</ul>`
                    : ""
                }
                <p style="margin: 0 0 12px 0; line-height: 1.5;">${escapeHtml(reviewLine)}</p>
                <p style="margin: 0 0 18px 0; line-height: 1.5;">${escapeHtml(contactLine)}</p>
                <p style="margin: 0; line-height: 1.5;">Met vriendelijke groet,<br>Kify</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    html,
    reason: "customer_notifiable",
    shouldSend: true,
    subject,
    text,
  };
}

