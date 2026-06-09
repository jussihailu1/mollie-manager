import { isSafeInvoiceRetryFailure } from "@/lib/eboekhouden/invoice-failure-retry";

export function filterSafeFailedInvoiceRetryIds(
  rows: Array<{ errorMessage: string | null; id: string }>,
) {
  return rows
    .filter((row) => isSafeInvoiceRetryFailure(row.errorMessage))
    .map((row) => row.id);
}
