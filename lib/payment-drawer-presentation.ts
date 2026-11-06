import { formatCurrency } from "./format";
import type { PaymentDrawerData, PaymentInvoiceState } from "./payment-details";

export const invoiceStatusLabels: Record<PaymentInvoiceState, string> = {
  not_applicable: "No invoice required",
  pending_invoice: "Waiting to be created",
  invoice_creating: "Being created",
  invoice_created: "Created — not sent yet",
  invoice_sent: "Sent",
  invoice_failed: "Needs attention",
  skipped: "Not created",
};

type PaymentNotice = {
  id: string;
  title: string;
  message: string;
  urgent: boolean;
};

type NoticeDetails = {
  payment: Pick<PaymentDrawerData["payment"],
    "status" | "statusReason" | "amountRefunded" | "amountChargedBack">;
  invoice: Pick<PaymentDrawerData["invoice"],
    "state" | "sentAt" | "documentAttachmentStatus" | "recipientOverridden" |
    "deliveryRecipient" | "intendedRecipient">;
};

export function getPaymentNotices(
  details: NoticeDetails | null,
  fallbackStatus: string,
): PaymentNotice[] {
  const notices: PaymentNotice[] = [];
  const status = details?.payment.status ?? fallbackStatus;
  const reason = details?.payment.statusReason?.message;

  if (["failed", "expired", "canceled"].includes(status)) {
    notices.push({
      id: "payment-unsuccessful",
      title: status === "failed" ? "Payment failed" : status === "expired" ? "Payment expired" : "Payment canceled",
      message: reason || "This payment was not completed. Check the customer's payments before arranging another payment.",
      urgent: true,
    });
  } else if (reason && status !== "paid") {
    notices.push({ id: "payment-status", title: "Payment update", message: reason, urgent: false });
  }

  if (!details) return notices;

  const { payment, invoice } = details;
  if (payment.amountChargedBack && Number(payment.amountChargedBack.value) > 0) {
    notices.push({
      id: "chargeback",
      title: "Payment charged back",
      message: `${formatCurrency(payment.amountChargedBack.value, payment.amountChargedBack.currency)} was reversed. Review the chargeback in Mollie.`,
      urgent: true,
    });
  }
  if (payment.amountRefunded && Number(payment.amountRefunded.value) > 0) {
    notices.push({
      id: "refund",
      title: "Payment refunded",
      message: `${formatCurrency(payment.amountRefunded.value, payment.amountRefunded.currency)} has been refunded.`,
      urgent: false,
    });
  }
  if (invoice.state === "invoice_failed") {
    notices.push({
      id: "invoice-failed",
      title: "Invoice needs attention",
      message: "The invoice could not be created or sent. Check its status before sending another invoice.",
      urgent: true,
    });
  }

  const invoiceWasSent = invoice.state === "invoice_sent" || Boolean(invoice.sentAt);
  if (invoiceWasSent && invoice.documentAttachmentStatus && invoice.documentAttachmentStatus !== "attached") {
    notices.push({
      id: "invoice-attachment",
      title: "Invoice sent without its PDF",
      message: "The invoice email was sent, but the PDF could not be attached. Share the invoice with the recipient if needed.",
      urgent: true,
    });
  }
  if (invoiceWasSent && invoice.recipientOverridden) {
    notices.push({
      id: "invoice-recipient",
      title: "Invoice sent to a different recipient",
      message: `Sent to ${invoice.deliveryRecipient ?? "an alternate recipient"}${invoice.intendedRecipient ? ` instead of ${invoice.intendedRecipient}` : ""}. Check that the customer received their invoice.`,
      urgent: true,
    });
  }

  return notices;
}
