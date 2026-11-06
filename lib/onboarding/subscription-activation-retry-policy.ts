export const ACTIVATION_RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1_000;

const RETRY_MS = [5, 15, 30, 60].map((minutes) => minutes * 60 * 1_000);

export function getSubscriptionActivationRetryDelay(attemptCount: number) {
  return RETRY_MS[Math.min(Math.max(attemptCount - 1, 0), RETRY_MS.length - 1)];
}
