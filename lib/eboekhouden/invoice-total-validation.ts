import { type TaxTreatment } from "@/lib/invoicing/tax-treatment";
import { toInvoiceAmountNumber } from "@/lib/eboekhouden/invoice-flow-helpers";

function cents(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) ||
      !Number.isSafeInteger(Math.round(value * 100)) ||
      Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) {
    throw new Error("e-Boekhouden returned an invalid invoice amount.");
  }
  return Math.round(value * 100);
}

export function assertEboekhoudenInvoiceTotal(input: {
  expectedAmount: string;
  invoice: { totalAmount?: number; vatAmount?: number };
  taxTreatment: TaxTreatment;
}) {
  const expectedCents = cents(toInvoiceAmountNumber(input.expectedAmount));
  if (input.invoice.totalAmount === undefined || cents(input.invoice.totalAmount) !== expectedCents) {
    throw new Error("e-Boekhouden invoice total differs from the Mollie subscription amount. Review the invoice before sending.");
  }
  const expectedVatCents = input.taxTreatment === "kor" ? 0 : Math.round(expectedCents * 21 / 121);
  if (input.invoice.vatAmount === undefined || cents(input.invoice.vatAmount) !== expectedVatCents) {
    throw new Error(input.taxTreatment === "kor"
      ? "e-Boekhouden invoice contains VAT while KOR is selected. Review the invoice before sending."
      : "e-Boekhouden invoice VAT differs from the selected 21% treatment. Review the invoice before sending.");
  }
}
