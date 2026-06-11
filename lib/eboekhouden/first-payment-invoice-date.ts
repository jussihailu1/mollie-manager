import { toInvoiceDateString } from "@/lib/eboekhouden/invoice-flow-helpers";

export function resolveFirstPaymentInvoiceDate(input: {
  paidAt: string | null;
  paymentCreatedAt: string;
}) {
  return (
    toInvoiceDateString(input.paidAt) ?? toInvoiceDateString(input.paymentCreatedAt)
  );
}
