import type { EboekhoudenInvoice } from "@/lib/eboekhouden/client";
import type { TaxTreatment } from "@/lib/invoicing/tax-treatment";

export function buildInvoiceCreationClaimMetadata(input: {
  actorEmail?: string | null;
  claimedAt?: string;
  taxTreatment?: TaxTreatment;
}) {
  return {
    invoiceCreationClaimedAt: input.claimedAt ?? new Date().toISOString(),
    invoiceCreationClaimedBy: input.actorEmail ?? null,
    ...(input.taxTreatment ? { invoiceTaxTreatment: input.taxTreatment } : {}),
  };
}

export function buildInvoiceCreationSuccessMetadata(input: {
  completedAt?: string;
  invoice: EboekhoudenInvoice;
}) {
  return {
    eboekhoudenInvoice: input.invoice,
    invoiceCreationCompletedAt: input.completedAt ?? new Date().toISOString(),
    invoiceCreationStatus: "success",
    invoiceCreationManualReview: false,
    eboekhoudenUnverifiedInvoice: null,
  };
}

export function buildInvoiceCreationFailureMetadata(input: {
  completedAt?: string;
  errorMessage: string;
  externalInvoice?: EboekhoudenInvoice | null;
  postAttempted?: boolean;
  reference?: string;
}) {
  return {
    invoiceCreationCompletedAt: input.completedAt ?? new Date().toISOString(),
    invoiceCreationError: input.errorMessage,
    invoiceCreationStatus: "failure",
    invoiceCreationManualReview: Boolean(input.externalInvoice || input.postAttempted),
    eboekhoudenUnverifiedInvoice: input.externalInvoice ? {
      id: input.externalInvoice.id ?? null,
      invoiceNumber: input.externalInvoice.invoiceNumber ?? input.externalInvoice.number ?? null,
      reference: input.reference ?? input.externalInvoice.reference ?? null,
    } : null,
  };
}
