export const EBOEKHOUDEN_INVOICE_REFERENCE_MAX_LENGTH = 50;

function compactDate(value: string | null) {
  if (!value) {
    return "000000";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value.slice(2, 4)}${value.slice(5, 7)}${value.slice(8, 10)}`;
  }

  return "000000";
}

function assertInvoiceReferenceLength(reference: string) {
  if (reference.length <= EBOEKHOUDEN_INVOICE_REFERENCE_MAX_LENGTH) {
    return reference;
  }

  throw new Error(
    `Invoice reference length ${reference.length} exceeds e-Boekhouden max ${EBOEKHOUDEN_INVOICE_REFERENCE_MAX_LENGTH}.`,
  );
}

export function buildFirstPaymentInvoiceReference(input: {
  invoiceDate: string | null;
  paymentId: string;
}) {
  return assertInvoiceReferenceLength(
    `FP-${input.paymentId.slice(0, 8)}-${compactDate(input.invoiceDate)}`,
  );
}

export function buildRecurringInvoiceReference(input: {
  plannedCollectionDate: string;
  scheduleId: string;
}) {
  return assertInvoiceReferenceLength(
    `RB-${input.scheduleId.slice(0, 8)}-${compactDate(input.plannedCollectionDate)}`,
  );
}
