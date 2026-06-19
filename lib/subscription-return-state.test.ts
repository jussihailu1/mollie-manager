import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getSubscriptionReturnState } from "@/lib/subscription-return-state";

describe("subscription return state", () => {
  it("confirms completed subscription setup", () => {
    const state = getSubscriptionReturnState({
      firstPaymentMode: "real_installment",
      firstPaymentStatus: "paid",
      paymentLinkStatus: "paid",
      subscriptionStatus: "active",
    });

    assert.equal(state.title, "Subscription confirmed");
    assert.equal(state.pending, false);
    assert.equal(state.tone, "success");
  });

  it("explains mandate-only completion separately from subscription activation", () => {
    const state = getSubscriptionReturnState({
      firstPaymentMode: "mandate_only",
      firstPaymentStatus: "paid",
      paymentLinkStatus: "paid",
      subscriptionStatus: null,
    });

    assert.equal(state.title, "Mandate setup completed");
    assert.match(state.description, /mandate setup payment/i);
  });

  it("keeps paid first payment pending while subscription activation catches up", () => {
    const state = getSubscriptionReturnState({
      firstPaymentMode: "real_installment",
      firstPaymentStatus: "paid",
      paymentLinkStatus: "paid",
      subscriptionStatus: null,
    });

    assert.equal(state.title, "Payment received");
    assert.equal(state.pending, true);
  });

  it("uses policy-safe copy for failed checkout without penalty language", () => {
    const state = getSubscriptionReturnState({
      firstPaymentMode: "real_installment",
      firstPaymentStatus: "failed",
      paymentLinkStatus: "failed",
      subscriptionStatus: null,
    });

    const copy = `${state.description} ${state.nextStep}`.toLowerCase();

    assert.equal(state.title, "Payment not completed");
    assert.equal(state.pending, false);
    assert.doesNotMatch(copy, /penalty|fee|cancelled|canceled|collection/);
  });

  it("explains pending SEPA status as normal while final status is unknown", () => {
    const state = getSubscriptionReturnState({
      firstPaymentMode: "real_installment",
      firstPaymentStatus: "pending",
      paymentLinkStatus: "open",
      subscriptionStatus: null,
    });

    assert.equal(state.title, "Confirming payment");
    assert.equal(state.pending, true);
    assert.match(state.description, /SEPA direct debit payments can stay pending/i);
  });
});
