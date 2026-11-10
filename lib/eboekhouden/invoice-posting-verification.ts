import { getEboekhoudenMutation, listEboekhoudenLedgers, listEboekhoudenSalesMutations, type EboekhoudenInvoice } from "@/lib/eboekhouden/client";
import { assertInvoiceSalesMutation } from "@/lib/eboekhouden/invoice-posting";
import { readAllEboekhoudenPages } from "@/lib/eboekhouden/pagination";

export async function verifyInvoiceSalesPosting(invoice: EboekhoudenInvoice, tenantId: string) {
  if (!invoice.invoiceNumber) throw new Error("Cannot verify sales posting without an invoice number.");
  const matches = await readAllEboekhoudenPages((limit, offset) =>
    listEboekhoudenSalesMutations({ invoiceNumber: invoice.invoiceNumber!, limit, offset, tenantId }),
  );
  // Check all matching entries, not outstanding debtors: a paid sale still exists.
  if (matches.length !== 1) {
    throw new Error("Expected exactly one sales posting for this invoice; manual review required. Do not recreate the invoice.");
  }
  const [mutation, ledgers] = await Promise.all([
    getEboekhoudenMutation(matches[0].id, tenantId),
    readAllEboekhoudenPages((limit, offset) => listEboekhoudenLedgers({ limit, offset, tenantId })),
  ]);
  if (mutation.id !== matches[0].id) throw new Error("Sales posting identity changed during verification.");
  assertInvoiceSalesMutation(invoice, mutation, ledgers);
  return { mutationId: mutation.id, verifiedAt: new Date().toISOString() };
}
