import { isSafeInvoiceRetryFailure } from "@/lib/eboekhouden/invoice-failure-retry";

export function filterSafeFailedInvoiceRetryIds(
  rows: Array<{ errorMessage: string | null; id: string; manualReview?: boolean }>,
) {
  return rows
    .filter((row) => !row.manualReview && isSafeInvoiceRetryFailure(row.errorMessage))
    .map((row) => row.id);
}
