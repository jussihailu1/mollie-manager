export const DELIVERY_BACKOFF_MINUTES = [5, 15, 60, 180, 720, 1440, 2880, 10080] as const;
export const MAX_DELIVERY_ATTEMPTS = DELIVERY_BACKOFF_MINUTES.length;

export function toInvoiceDeliveryAttemptCount(metadata: Record<string, unknown>) {
  const raw = metadata.invoiceDeliveryAttemptCount;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(Math.trunc(raw), 0);
  }

  if (typeof raw === "string") {
    const value = Number(raw);
    if (Number.isFinite(value)) {
      return Math.max(Math.trunc(value), 0);
    }
  }

  return 0;
}

export function getNextRetryAtIso(attemptCount: number, now = Date.now()) {
  const index = Math.min(
    Math.max(attemptCount - 1, 0),
    DELIVERY_BACKOFF_MINUTES.length - 1,
  );
  const minutes = DELIVERY_BACKOFF_MINUTES[index] ?? DELIVERY_BACKOFF_MINUTES[0];
  return new Date(now + minutes * 60_000).toISOString();
}
