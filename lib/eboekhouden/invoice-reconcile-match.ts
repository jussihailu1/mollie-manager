export type ReconcileMatchInput = {
  date: string;
  reference: string;
  relationId: number;
};

export type ReconcileInvoiceCandidate = {
  date?: string | null;
  id?: number;
  invoiceNumber?: string | null;
  number?: string | null;
  reference?: string | null;
  relationId?: number | null;
};

export function filterMatchingInvoicesByReference(
  invoices: ReconcileInvoiceCandidate[],
  input: ReconcileMatchInput,
) {
  return invoices.filter(
    (invoice) =>
      invoice.reference === input.reference &&
      invoice.relationId === input.relationId &&
      invoice.date === input.date,
  );
}
