export const ACTIVATION_RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1_000;

const RETRY_MS = [60, 2 * 60, 4 * 60, 8 * 60].map((hours) => hours * 60 * 1_000);

export function getSubscriptionActivationRetryDelay(attemptCount: number) {
  return RETRY_MS[Math.min(Math.max(attemptCount - 1, 0), RETRY_MS.length - 1)];
}
