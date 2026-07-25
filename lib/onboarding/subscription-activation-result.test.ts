import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeSubscriptionActivationResult } from "@/lib/onboarding/subscription-activation-result";

describe("subscription activation result helpers", () => {
  it("describes created and already-exists outcomes", () => {
    assert.deepEqual(
      describeSubscriptionActivationResult({
        firstPaymentMode: "real_installment",
        mollieSubscriptionId: "sub_123",
        status: "created",
        subscriptionId: "sub_local",
      }),
      {
        error: null,
        notice:
          "Subscription activation retried successfully. Future charges are now scheduled in Mollie.",
        shouldRevalidate: true,
      },
    );

    assert.deepEqual(
      describeSubscriptionActivationResult({
        firstPaymentMode: "real_installment",
        reason: "consent_already_used",
        status: "already_exists",
        subscriptionId: "sub_local",
      }),
      {
        error: null,
        notice: "A subscription already exists for this onboarding flow.",
        shouldRevalidate: false,
      },
    );
  });

  it("describes pending prerequisite outcomes", () => {
    assert.deepEqual(
      describeSubscriptionActivationResult({
        firstPaymentMode: null,
        reason: "missing_consent",
        status: "pending_prerequisites",
      }),
      {
        error: "No accepted consent was found yet. Complete the consent flow first.",
        notice: null,
        shouldRevalidate: false,
      },
    );
  });

  it("passes through failed activation messages", () => {
    assert.deepEqual(
      describeSubscriptionActivationResult({
        firstPaymentMode: null,
        message: "Upstream failed",
        status: "failed",
      }),
      {
        error: "Upstream failed",
        notice: null,
        shouldRevalidate: false,
      },
    );
  });
});
