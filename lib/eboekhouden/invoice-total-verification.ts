import { getEboekhoudenInvoice, type EboekhoudenInvoice } from "@/lib/eboekhouden/client";
import { assertEboekhoudenInvoiceTotal } from "@/lib/eboekhouden/invoice-total-validation";
import { requireTaxTreatment, type TaxTreatment } from "@/lib/invoicing/tax-treatment";
import { verifyInvoiceSalesPosting } from "@/lib/eboekhouden/invoice-posting-verification";

export type EboekhoudenApiVerification = {
  expectedAmount: string;
  expectedDate: string;
  taxTreatment: TaxTreatment;
  verifiedAt: string;
  salesPosting?: { mutationId: number; verifiedAt: string };
};

export function requireInvoiceDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error("A valid original invoice date is required; review issuance evidence before proceeding.");
  }
  return value;
}

export async function verifiedEboekhoudenInvoice(input: {
  expectedAmount: string;
  expectedDate: string;
  expectedRelationId: number;
  expectedReference?: string;
  invoice: EboekhoudenInvoice;
  taxTreatment: TaxTreatment;
  tenantId: string;
  requireSalesPosting?: boolean;
}) {
  if (!Number.isSafeInteger(input.invoice.id) || input.invoice.id! <= 0) throw new Error("e-Boekhouden did not return a valid invoice ID for verification.");
  if (!Number.isSafeInteger(input.expectedRelationId) || input.expectedRelationId <= 0) throw new Error("A valid expected e-Boekhouden relation ID is required for verification.");
  const taxTreatment = requireTaxTreatment(input.taxTreatment);
  const expectedDate = requireInvoiceDate(input.expectedDate);
  if (input.invoice.date != null && input.invoice.date !== expectedDate) {
    throw new Error("e-Boekhouden invoice date differs from the expected issuance date; manual review is required.");
  }
  const invoice = await getEboekhoudenInvoice(input.invoice.id!, input.tenantId);
  if (invoice.id !== input.invoice.id ||
      invoice.date !== expectedDate ||
      invoice.relationId !== input.expectedRelationId ||
      (input.expectedReference !== undefined && invoice.reference !== input.expectedReference) ||
      (input.invoice.reference != null && invoice.reference !== input.invoice.reference) ||
      ((input.invoice.invoiceNumber ?? input.invoice.number) != null && (invoice.invoiceNumber ?? invoice.number) !== (input.invoice.invoiceNumber ?? input.invoice.number))) {
    throw new Error("e-Boekhouden invoice identity changed during verification; manual review is required.");
  }
  assertEboekhoudenInvoiceTotal({ expectedAmount: input.expectedAmount, invoice, taxTreatment });
  const invoiceNumber = invoice.invoiceNumber ?? invoice.number;
  if (typeof invoiceNumber !== "string" || !invoiceNumber.trim()) throw new Error("e-Boekhouden did not return an invoice number for verification.");
  const apiVerification: EboekhoudenApiVerification = {
    expectedAmount: input.expectedAmount,
    expectedDate,
    taxTreatment,
    verifiedAt: new Date().toISOString(),
    ...(input.requireSalesPosting ? { salesPosting: await verifyInvoiceSalesPosting(invoice, input.tenantId) } : {}),
  };
  return { ...invoice, apiVerification };
}

// Delivery retries use frozen issuance evidence, never today's tenant setting.
// A different PDF encoding/layout has no bearing on these API checks.
export async function verifiedEboekhoudenInvoiceForDelivery(input: {
  providerInvoiceId: string | null;
  providerInvoiceNumber: string | null;
  providerSnapshot: Record<string, unknown>;
  tenantId: string;
}) {
  const snapshot = input.providerSnapshot;
  const verification = snapshot.apiVerification;
  if (!verification || typeof verification !== "object" ||
      !("expectedAmount" in verification) || typeof verification.expectedAmount !== "string" ||
      !("taxTreatment" in verification) || (verification.taxTreatment !== "kor" && verification.taxTreatment !== "standard")) {
    throw new Error("Invoice has no verified issuance amount/tax treatment; review the original invoice before delivery.");
  }
  const invoiceId = Number(input.providerInvoiceId);
  // Older verified snapshots may predate expectedDate. Use their frozen document
  // date, never a current schedule or a fresh provider read as historical evidence.
  const expectedDate = requireInvoiceDate("expectedDate" in verification ? verification.expectedDate : snapshot.date);
  if (snapshot.date != null && snapshot.date !== expectedDate) {
    throw new Error("Stored invoice dates disagree; review the original issuance evidence before delivery.");
  }
  if (snapshot.id !== invoiceId || !input.providerInvoiceNumber ||
      (snapshot.invoiceNumber ?? snapshot.number) !== input.providerInvoiceNumber || typeof snapshot.relationId !== "number" ||
      (snapshot.reference != null && typeof snapshot.reference !== "string")) {
    throw new Error("Stored e-Boekhouden invoice identity is inconsistent; review before delivery.");
  }
  return verifiedEboekhoudenInvoice({
    expectedAmount: verification.expectedAmount,
    expectedDate,
    expectedRelationId: snapshot.relationId,
    expectedReference: typeof snapshot.reference === "string" ? snapshot.reference : undefined,
    invoice: { id: invoiceId, invoiceNumber: input.providerInvoiceNumber },
    taxTreatment: verification.taxTreatment,
    tenantId: input.tenantId,
  });
}
