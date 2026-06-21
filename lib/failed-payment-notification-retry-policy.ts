export const FAILED_PAYMENT_NOTIFICATION_RETRY_DELAY_MS = 30 * 60 * 1_000;
export const FAILED_PAYMENT_NOTIFICATION_CLAIM_TIMEOUT_MS = 15 * 60 * 1_000;
export const MAX_FAILED_PAYMENT_NOTIFICATION_ATTEMPTS = 3;

export type FailedPaymentNotificationRetryState = {
  attemptCount: number;
  claimedAt: Date | number | string | null;
  failedAt: Date | number | string | null;
  status: "claimed" | "failed" | "sent" | "skipped";
};

function toTimestamp(value: Date | number | string | null) {
  if (value === null) {
    return null;
  }

  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function canReclaimFailedPaymentNotification(
  notification: FailedPaymentNotificationRetryState,
  now: Date | number = Date.now(),
) {
  if (notification.attemptCount >= MAX_FAILED_PAYMENT_NOTIFICATION_ATTEMPTS) {
    return false;
  }

  const nowTimestamp = now instanceof Date ? now.getTime() : now;

  if (notification.status === "failed") {
    const failedAt = toTimestamp(notification.failedAt);
    return (
      failedAt !== null &&
      nowTimestamp - failedAt >= FAILED_PAYMENT_NOTIFICATION_RETRY_DELAY_MS
    );
  }

  if (notification.status === "claimed") {
    const claimedAt = toTimestamp(notification.claimedAt);
    return (
      claimedAt !== null &&
      nowTimestamp - claimedAt >= FAILED_PAYMENT_NOTIFICATION_CLAIM_TIMEOUT_MS
    );
  }

  return false;
}
