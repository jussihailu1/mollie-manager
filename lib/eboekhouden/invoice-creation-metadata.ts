import type { EboekhoudenInvoice } from "@/lib/eboekhouden/client";

export function buildInvoiceCreationSuccessMetadata(input: {
  completedAt?: string;
  invoice: EboekhoudenInvoice;
}) {
  return {
    eboekhoudenInvoice: input.invoice,
    invoiceCreationCompletedAt: input.completedAt ?? new Date().toISOString(),
    invoiceCreationStatus: "success",
  };
}

export function buildInvoiceCreationFailureMetadata(input: {
  completedAt?: string;
  errorMessage: string;
}) {
  return {
    invoiceCreationCompletedAt: input.completedAt ?? new Date().toISOString(),
    invoiceCreationError: input.errorMessage,
    invoiceCreationStatus: "failure",
  };
}
