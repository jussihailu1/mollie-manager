export const SAFE_INVOICE_RETRY_FAILURE_CODES = [
  "FACT_014",
  "FACT_VERWERK_004",
] as const;

export function isSafeInvoiceRetryFailure(errorMessage: string | null) {
  if (!errorMessage) {
    return false;
  }

  return SAFE_INVOICE_RETRY_FAILURE_CODES.some((code) =>
    errorMessage.includes(code),
  );
}
