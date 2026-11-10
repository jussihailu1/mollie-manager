import type { EboekhoudenInvoice, EboekhoudenLedger } from "@/lib/eboekhouden/client";
import { amountCents, assertInvoiceSalesMutation, invoicePostingReference, invoiceSalesRows, resolveDebtorLedger, type SalesMutation } from "@/lib/eboekhouden/invoice-posting";
import { invoiceDateReviewMatches, type InvoiceDateReview } from "@/lib/eboekhouden/sales-posting-date-review";

export type LocalPostingInvoice = {
  localInvoiceId: string;
  providerInvoiceId: string;
  invoiceNumber: string;
  relationId: number;
  reference: string;
  invoiceDate: string;
  amountValue: string;
  currency: string;
};

export function previewSalesPosting(input: {
  local: LocalPostingInvoice;
  invoice: EboekhoudenInvoice;
  mutations: SalesMutation[];
  ledgers: EboekhoudenLedger[];
  outstanding: { invoiceNumber?: string; relationId?: number; mutationId?: number }[];
  otherInvoices?: EboekhoudenInvoice[];
  dateReview?: InvoiceDateReview;
}) {
  const { local, invoice, mutations, ledgers } = input;
  const acceptedDateReview = input.dateReview && invoiceDateReviewMatches(input.dateReview, local, invoice) ? input.dateReview : null;
  const identityDifferences = [
    ["providerInvoiceId", Number(local.providerInvoiceId), invoice.id],
    ["invoiceNumber", local.invoiceNumber, invoice.invoiceNumber],
    ["relationId", local.relationId, invoice.relationId],
    ["reference", local.reference, invoice.reference],
    ["date", local.invoiceDate, invoice.date],
    ["amount", Number(local.amountValue), invoice.totalAmount],
  ].filter(([, expected, actual]) => expected !== actual).map(([field, expected, actual]) => ({ field, expected, actual }));
  const base = { localInvoiceId: local.localInvoiceId, providerInvoiceId: local.providerInvoiceId, invoiceNumber: local.invoiceNumber, reference: local.reference, date: invoice.date, amount: invoice.totalAmount, identityDifferences, acceptedDateReview };
  const review = (reason: string, candidateMutationIds: number[] = []) => ({ ...base, status: "review_required" as const, reason, candidateMutationIds, proposedMutation: null });
  try {
    if (input.dateReview && !acceptedDateReview) return review("Reviewed date evidence no longer matches this invoice/owner, date, amount or payment term.");
    if (invoice.id !== Number(local.providerInvoiceId) || invoice.invoiceNumber !== local.invoiceNumber ||
        invoice.relationId !== local.relationId || invoice.reference !== local.reference || (invoice.date !== local.invoiceDate && !acceptedDateReview) ||
        local.currency !== "EUR" || !/^\d+\.\d{2}$/.test(local.amountValue) || typeof invoice.totalAmount !== "number" ||
        amountCents(invoice.totalAmount) !== amountCents(Number(local.amountValue))) {
      return review("Provider document differs from the stored invoice/owner identity, date or amount.");
    }
    const reference = invoicePostingReference(invoice.reference);
    const debtor = resolveDebtorLedger(ledgers);
    const rows = invoiceSalesRows(invoice);
    if (rows.some(row => !ledgers.some(ledger => ledger.id === row.ledgerId && !!ledger.category && !["DEB", "CRED", "FIN"].includes(ledger.category)))) {
      return review("An original invoice line ledger is missing or unsuitable for a sales posting.");
    }
    const exact = mutations.filter(mutation => String(mutation.type) === "2" && mutation.invoiceNumber === invoice.invoiceNumber);
    if (exact.length > 1) return review("Multiple sales entries use this invoice number.", exact.map(mutation => mutation.id));
    if (exact.length === 1) {
      try { assertInvoiceSalesMutation(invoice, exact[0], ledgers); }
      catch { return review("An existing sales entry differs from the original invoice; do not add another.", [exact[0].id]); }
      return { ...base, status: "already_posted" as const, reason: "Matching sales entry exists, whether paid or outstanding.", candidateMutationIds: [exact[0].id], proposedMutation: null };
    }
    const mentions = (text: string | undefined) => !!text && (text.toLowerCase().includes(local.invoiceNumber.toLowerCase()) || text.toLowerCase().includes(reference.toLowerCase()));
    const candidates = mutations.filter(mutation => {
      if ([mutation.invoiceNumber, mutation.description, mutation.entryNumber].some(mentions) ||
          mutation.rows?.some(row => mentions(row.invoiceNumber) || mentions(row.description))) return true;
      const days = Math.abs(Date.parse(mutation.date ?? "") - Date.parse(invoice.date ?? "")) / 86_400_000;
      const salesRows = mutation.rows?.filter(row => rows.some(original => original.ledgerId === row.ledgerId)) ?? [];
      // Also catch manual journal/direct-bank revenue with no original reference.
      return days <= 31 && salesRows.length > 0 &&
        (mutation.relationId === invoice.relationId || salesRows.some(row => [invoice.totalAmount!, invoice.totalExcl!].some(amount => amountCents(Math.abs(row.amount)) === amountCents(amount))));
    });
    if (candidates.length) return review("Possible prior payment, credit or manual revenue posting; inspect before repair.", candidates.map(mutation => mutation.id));
    if (input.outstanding.some(item => item.invoiceNumber === local.invoiceNumber && item.relationId === local.relationId)) {
      return review("Outstanding debtor entry exists without a verified sales entry in the scan.");
    }
    if (input.otherInvoices?.some(other => other.id !== invoice.id && other.relationId === invoice.relationId &&
        (other.reference === reference || (other.totalAmount! < 0 && other.date === invoice.date && amountCents(-other.totalAmount!) === amountCents(invoice.totalAmount!))))) {
      return review("Related/credit invoice document exists; review replacement history before repair.");
    }
    return {
      ...base,
      status: "missing_sales_posting" as const,
      reason: "No sales posting or candidate correction found. Preview only; recheck before any later repair.",
      candidateMutationIds: [],
      proposedMutation: {
        type: 2,
        date: invoice.date,
        invoiceNumber: invoice.invoiceNumber,
        relationId: invoice.relationId,
        ledgerId: debtor.id,
        termOfPayment: invoice.termOfPayment ?? 0,
        inExVat: invoice.inExVat,
        description: `Kify ${reference}`.slice(0, 50),
        paymentReference: reference,
        checkPaymentReference: true,
        rows,
      },
    };
  } catch (error) {
    return review(error instanceof Error ? error.message : "Invoice requires manual review.");
  }
}
