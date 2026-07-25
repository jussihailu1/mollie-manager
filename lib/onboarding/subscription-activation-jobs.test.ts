import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ACTIVATION_RECOVERY_WINDOW_MS,
  getSubscriptionActivationRetryDelay,
} from "@/lib/onboarding/subscription-activation-retry-policy";

describe("subscription activation recovery policy", () => {
  it("uses a bounded 24-hour recovery window with increasing retry delays", () => {
    assert.equal(ACTIVATION_RECOVERY_WINDOW_MS, 24 * 60 * 60 * 1_000);
    assert.equal(getSubscriptionActivationRetryDelay(1), 60 * 60 * 1_000);
    assert.equal(getSubscriptionActivationRetryDelay(2), 2 * 60 * 60 * 1_000);
    assert.equal(getSubscriptionActivationRetryDelay(10), 8 * 60 * 60 * 1_000);
  });
});
