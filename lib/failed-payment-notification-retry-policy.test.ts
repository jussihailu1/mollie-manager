import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canReclaimFailedPaymentNotification,
  FAILED_PAYMENT_NOTIFICATION_CLAIM_TIMEOUT_MS,
  FAILED_PAYMENT_NOTIFICATION_RETRY_DELAY_MS,
  MAX_FAILED_PAYMENT_NOTIFICATION_ATTEMPTS,
  type FailedPaymentNotificationRetryState,
} from "@/lib/failed-payment-notification-retry-policy";

const now = Date.UTC(2026, 5, 21, 12);

function buildState(
  overrides: Partial<FailedPaymentNotificationRetryState>,
): FailedPaymentNotificationRetryState {
  return {
    attemptCount: 1,
    claimedAt: now,
    failedAt: now,
    status: "failed",
    ...overrides,
  };
}

describe("failed payment notification retry policy", () => {
  it("reclaims failed notifications only after the retry delay", () => {
    assert.equal(
      canReclaimFailedPaymentNotification(
        buildState({ failedAt: now - FAILED_PAYMENT_NOTIFICATION_RETRY_DELAY_MS + 1 }),
        now,
      ),
      false,
    );
    assert.equal(
      canReclaimFailedPaymentNotification(
        buildState({ failedAt: now - FAILED_PAYMENT_NOTIFICATION_RETRY_DELAY_MS }),
        now,
      ),
      true,
    );
  });

  it("does not reclaim notifications at the maximum attempt count", () => {
    assert.equal(
      canReclaimFailedPaymentNotification(
        buildState({
          attemptCount: MAX_FAILED_PAYMENT_NOTIFICATION_ATTEMPTS - 1,
          failedAt: now - FAILED_PAYMENT_NOTIFICATION_RETRY_DELAY_MS,
        }),
        now,
      ),
      true,
    );
    assert.equal(
      canReclaimFailedPaymentNotification(
        buildState({
          attemptCount: MAX_FAILED_PAYMENT_NOTIFICATION_ATTEMPTS,
          failedAt: now - FAILED_PAYMENT_NOTIFICATION_RETRY_DELAY_MS,
        }),
        now,
      ),
      false,
    );
  });

  it("never reclaims sent or skipped notifications", () => {
    for (const status of ["sent", "skipped"] as const) {
      assert.equal(
        canReclaimFailedPaymentNotification(
          buildState({
            claimedAt: now - FAILED_PAYMENT_NOTIFICATION_CLAIM_TIMEOUT_MS,
            failedAt: now - FAILED_PAYMENT_NOTIFICATION_RETRY_DELAY_MS,
            status,
          }),
          now,
        ),
        false,
      );
    }
  });

  it("reclaims claimed notifications only when the claim is stale", () => {
    assert.equal(
      canReclaimFailedPaymentNotification(
        buildState({
          claimedAt: now - FAILED_PAYMENT_NOTIFICATION_CLAIM_TIMEOUT_MS + 1,
          status: "claimed",
        }),
        now,
      ),
      false,
    );
    assert.equal(
      canReclaimFailedPaymentNotification(
        buildState({
          claimedAt: now - FAILED_PAYMENT_NOTIFICATION_CLAIM_TIMEOUT_MS,
          status: "claimed",
        }),
        now,
      ),
      true,
    );
  });
});
