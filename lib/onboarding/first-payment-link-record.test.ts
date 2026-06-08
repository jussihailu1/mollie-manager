import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PaymentMethod, SequenceType } from "@mollie/api-client";

import {
  buildFirstPaymentLinkMetadata,
  deriveFirstPaymentLinkAmount,
  deriveFirstPaymentLinkStatus,
} from "@/lib/onboarding/first-payment-link-record";

describe("first payment link record helpers", () => {
  it("derives durable local status from Mollie payment link state", () => {
    assert.equal(deriveFirstPaymentLinkStatus({ archived: true }), "archived");
    assert.equal(deriveFirstPaymentLinkStatus({ paidAt: "2026-06-08T10:00:00Z" }), "paid");
    assert.equal(deriveFirstPaymentLinkStatus({}), "open");
  });

  it("uses Mollie amount when available and falls back to requested amount", () => {
    assert.deepEqual(
      deriveFirstPaymentLinkAmount(
        {
          amount: {
            currency: "EUR",
            value: "42.00",
          },
        },
        "25.00",
      ),
      {
        currency: "EUR",
        value: "42.00",
      },
    );
    assert.deepEqual(deriveFirstPaymentLinkAmount({}, "25.00"), {
      currency: "EUR",
      value: "25.00",
    });
  });

  it("builds non-secret subscription onboarding metadata", () => {
    assert.deepEqual(
      buildFirstPaymentLinkMetadata({
        mollieCustomerId: "cst_test",
        paymentLink: {
          allowedMethods: [PaymentMethod.ideal],
          reusable: null,
          sequenceType: null,
        },
        redirectUrl: "https://app.test/subscribe/token/return",
      }),
      {
        allowedMethods: [PaymentMethod.ideal],
        latestPaymentId: null,
        latestPaymentStatus: null,
        mollieCustomerId: "cst_test",
        paymentType: "first",
        redirectUrl: "https://app.test/subscribe/token/return",
        reusable: false,
        sequenceType: SequenceType.first,
        source: "subscription_onboarding",
      },
    );
  });
});
