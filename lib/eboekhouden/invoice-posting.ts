import type { EboekhoudenCreateInvoiceInput, EboekhoudenInvoice, EboekhoudenLedger } from "@/lib/eboekhouden/client";

export type SalesMutationRow = {
  ledgerId: number;
  amount: number;
  vatCode: string;
  costCenterId?: number | null;
  description?: string;
  invoiceNumber?: string;
  relationId?: number;
};

export type SalesMutation = {
  id: number;
  type: number | string;
  date?: string;
  invoiceNumber?: string;
  relationId?: number;
  ledgerId?: number;
  inExVat?: string;
  description?: string;
  entryNumber?: string;
  rows?: SalesMutationRow[];
};

export function amountCents(value: number): number {
  const cents = Math.round(value * 100);
  if (!Number.isFinite(value) || !Number.isSafeInteger(cents)) throw new Error("Invalid accounting amount.");
  return cents;
}

export function resolveDebtorLedger(ledgers: EboekhoudenLedger[]) {
  const debtors = ledgers.filter(ledger => ledger.category === "DEB");
  if (debtors.length !== 1 || !Number.isSafeInteger(debtors[0].id) || debtors[0].id <= 0) {
    throw new Error("Exactly one e-Boekhouden debtor ledger is required; review the administration mapping.");
  }
  return debtors[0];
}

export function invoicePostingReference(reference: string | null | undefined) {
  if (!reference || !reference.trim() || reference !== reference.trim() || reference.length > 50) {
    throw new Error("A stable invoice reference of at most 50 characters is required for sales posting.");
  }
  return reference;
}

export function buildPostedInvoicePayload(input: EboekhoudenCreateInvoiceInput, ledgers: EboekhoudenLedger[]) {
  const reference = invoicePostingReference(input.reference);
  const debtor = resolveDebtorLedger(ledgers);
  if (!input.items.length) throw new Error("Sales posting requires invoice items.");
  for (const item of input.items) {
    const ledger = ledgers.find(candidate => candidate.id === item.ledgerId);
    if (!ledger?.category || ["DEB", "CRED", "FIN"].includes(ledger.category)) {
      throw new Error("Invoice item ledger is missing or cannot be used for a sales posting.");
    }
  }
  return {
    ...input,
    mutation: {
      ledgerId: debtor.id,
      description: `Kify ${reference}`,
      paymentReference: reference,
      checkPaymentReference: true,
    },
  };
}

// Use the original document's lines and VAT basis, never today's billing settings.
// Unsupported/discounted historical documents require individual review.
export function invoiceSalesRows(invoice: EboekhoudenInvoice): SalesMutationRow[] {
  if (!invoice.items?.length || !["IN", "EX"].includes(invoice.inExVat ?? "")) {
    throw new Error("Invoice lines or VAT basis are missing.");
  }
  const rows = invoice.items.map(item => {
    if (item.discountAmount || item.discountPercentage ||
        !Number.isFinite(item.quantity) || item.quantity! <= 0 ||
        !Number.isFinite(item.pricePerUnit) || item.pricePerUnit <= 0 ||
        !Number.isSafeInteger(item.ledgerId) || !item.vatCode || item.vatCode === "AFW_VERK") {
      throw new Error("Invoice has unsupported lines; review its original amounts and VAT manually.");
    }
    return {
      ledgerId: item.ledgerId,
      vatCode: item.vatCode,
      amount: amountCents(item.quantity! * item.pricePerUnit) / 100,
      description: item.description,
      ...(item.costCenterId ? { costCenterId: item.costCenterId } : {}),
    };
  });
  if (typeof invoice.totalAmount !== "number" || typeof invoice.totalExcl !== "number" || typeof invoice.vatAmount !== "number" ||
      amountCents(invoice.totalAmount) !== amountCents(invoice.totalExcl) + amountCents(invoice.vatAmount) ||
      rows.reduce((sum, row) => sum + amountCents(row.amount), 0) !== amountCents(invoice.inExVat === "IN" ? invoice.totalAmount : invoice.totalExcl) ||
      (rows.every(row => row.vatCode === "GEEN") && amountCents(invoice.vatAmount) !== 0)) {
    throw new Error("Invoice line amounts/VAT do not reconcile with the document totals.");
  }
  return rows;
}

function groupedRows(rows: SalesMutationRow[]) {
  const amounts = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.ledgerId}:${row.vatCode}:${row.costCenterId || 0}`;
    amounts.set(key, (amounts.get(key) ?? 0) + amountCents(row.amount));
  }
  return JSON.stringify([...amounts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export function assertInvoiceSalesMutation(invoice: EboekhoudenInvoice, mutation: SalesMutation, ledgers: EboekhoudenLedger[]) {
  const expectedRows = invoiceSalesRows(invoice);
  // e-Boekhouden may display a zero-VAT sale on either basis; both amounts are
  // identical. Nonzero-VAT basis changes stay held for explicit verification.
  const sameBasis = mutation.inExVat === invoice.inExVat ||
    (["IN", "EX"].includes(mutation.inExVat ?? "") && invoice.vatAmount === 0 && expectedRows.every(row => row.vatCode === "GEEN"));
  if (String(mutation.type) !== "2" || mutation.invoiceNumber !== invoice.invoiceNumber ||
      mutation.relationId !== invoice.relationId || mutation.date !== invoice.date ||
      mutation.ledgerId !== resolveDebtorLedger(ledgers).id || !sameBasis ||
      !mutation.rows?.length || groupedRows(mutation.rows) !== groupedRows(expectedRows)) {
    throw new Error("Sales posting does not match the invoice identity, date, debtor, ledger amounts or VAT; manual review required.");
  }
}
