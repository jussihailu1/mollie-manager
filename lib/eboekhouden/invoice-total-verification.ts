import { getEboekhoudenInvoice, type EboekhoudenInvoice } from "@/lib/eboekhouden/client";
import { assertEboekhoudenInvoiceTotal } from "@/lib/eboekhouden/invoice-total-validation";
import { requireTaxTreatment, type TaxTreatment } from "@/lib/invoicing/tax-treatment";

export type EboekhoudenApiVerification = {
  expectedAmount: string;
  taxTreatment: TaxTreatment;
  verifiedAt: string;
};

export async function verifiedEboekhoudenInvoice(input: {
  expectedAmount: string;
  expectedRelationId: number;
  expectedReference?: string;
  invoice: EboekhoudenInvoice;
  taxTreatment: TaxTreatment;
  tenantId: string;
}) {
  if (!Number.isSafeInteger(input.invoice.id) || input.invoice.id! <= 0) throw new Error("e-Boekhouden did not return a valid invoice ID for verification.");
  if (!Number.isSafeInteger(input.expectedRelationId) || input.expectedRelationId <= 0) throw new Error("A valid expected e-Boekhouden relation ID is required for verification.");
  const taxTreatment = requireTaxTreatment(input.taxTreatment);
  const invoice = await getEboekhoudenInvoice(input.invoice.id!, input.tenantId);
  if (invoice.id !== input.invoice.id ||
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
    taxTreatment,
    verifiedAt: new Date().toISOString(),
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
  if (snapshot.id !== invoiceId || !input.providerInvoiceNumber ||
      (snapshot.invoiceNumber ?? snapshot.number) !== input.providerInvoiceNumber || typeof snapshot.relationId !== "number" ||
      (snapshot.reference != null && typeof snapshot.reference !== "string")) {
    throw new Error("Stored e-Boekhouden invoice identity is inconsistent; review before delivery.");
  }
  return verifiedEboekhoudenInvoice({
    expectedAmount: verification.expectedAmount,
    expectedRelationId: snapshot.relationId,
    expectedReference: typeof snapshot.reference === "string" ? snapshot.reference : undefined,
    invoice: { id: invoiceId, invoiceNumber: input.providerInvoiceNumber },
    taxTreatment: verification.taxTreatment,
    tenantId: input.tenantId,
  });
}
