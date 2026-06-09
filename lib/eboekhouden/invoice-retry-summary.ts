import { isSafeInvoiceRetryFailure } from "@/lib/eboekhouden/invoice-failure-retry";

export function countSafeInvoiceRetryFailures(
  rows: Array<{ errorMessage: string | null }>,
) {
  let retryableCount = 0;

  for (const row of rows) {
    if (isSafeInvoiceRetryFailure(row.errorMessage)) {
      retryableCount += 1;
    }
  }

  return {
    retryableCount,
    totalFailedCount: rows.length,
  };
}
