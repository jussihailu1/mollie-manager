import type { EboekhoudenInvoice } from "@/lib/eboekhouden/client";

export function buildInvoiceCreationClaimMetadata(input: {
  actorEmail?: string | null;
  claimedAt?: string;
}) {
  return {
    invoiceCreationClaimedAt: input.claimedAt ?? new Date().toISOString(),
    invoiceCreationClaimedBy: input.actorEmail ?? null,
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
