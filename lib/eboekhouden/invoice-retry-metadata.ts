import { SAFE_INVOICE_RETRY_FAILURE_CODES } from "@/lib/eboekhouden/invoice-failure-retry";

export function buildInvoiceRetryQueuedMetadata(input: {
  actorEmail?: string | null;
  includeAllowedFailureCodes?: boolean;
  queuedAt?: string;
}) {
  return {
    invoiceRetryQueuedAt: input.queuedAt ?? new Date().toISOString(),
    invoiceRetryQueuedBy: input.actorEmail ?? null,
    ...(input.includeAllowedFailureCodes
      ? {
          invoiceRetryAllowedFailureCodes: SAFE_INVOICE_RETRY_FAILURE_CODES,
        }
      : {}),
  };
}
