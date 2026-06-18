import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyPaymentOutcome } from "@/lib/payment-outcome-classification";
import { classifyRecurringCollection } from "@/lib/recurring-billing-policy";

describe("payment outcome classification", () => {
  it("keeps recurring SEPA pending inside the safe return window", () => {
    const outcome = classifyPaymentOutcome({
      createdAt: "2026-06-01T10:00:00.000Z",
      flowKind: "recurring",
      now: "2026-06-04T10:00:00.000Z",
      status: "pending",
    });

    assert.equal(outcome.state, "pending");
    assert.equal(outcome.operatorTaskRequired, false);
    assert.equal(outcome.customerNotificationAllowed, false);
    assert.equal(outcome.safePendingWindowEndsAt, "2026-06-06T10:00:00.000Z");
  });

  it("moves long-pending recurring payments to review after the safe window", () => {
    const outcome = classifyPaymentOutcome({
      createdAt: "2026-06-01T10:00:00.000Z",
      flowKind: "recurring",
      now: "2026-06-07T10:00:01.000Z",
      status: "pending",
    });

    assert.equal(outcome.state, "needs_review");
    assert.equal(outcome.reason, "long_pending_window_elapsed");
    assert.equal(outcome.operatorTaskRequired, true);
    assert.equal(outcome.customerNotificationAllowed, true);
  });

  it("classifies ordinary recurring failures without implying consequences", () => {
    const outcome = classifyPaymentOutcome({
      flowKind: "recurring",
      status: "failed",
      statusReason: "Insufficient funds",
    });

    assert.equal(outcome.state, "failed");
    assert.equal(outcome.reason, "definitive_failed_status");
    assert.equal(outcome.operatorTaskRequired, true);
    assert.equal(outcome.customerNotificationAllowed, true);
  });

  it("classifies mandate-only setup failures as mandate problems", () => {
    const outcome = classifyPaymentOutcome({
      flowKind: "mandate_only",
      status: "failed",
      statusReason: "Customer abandoned checkout",
    });

    assert.equal(outcome.state, "mandate_problem");
    assert.equal(outcome.reason, "mandate_setup_failed");
  });

  it("classifies first-payment failures separately from mandate-only setup", () => {
    const outcome = classifyPaymentOutcome({
      flowKind: "first_payment",
      status: "expired",
    });

    assert.equal(outcome.state, "failed");
    assert.equal(outcome.reason, "definitive_failed_status");
  });

  it("classifies mandate signals before ordinary failure handling", () => {
    assert.equal(
      classifyPaymentOutcome({
        flowKind: "recurring",
        hasUsableMandate: false,
        status: "pending",
      }).state,
      "mandate_problem",
    );
    assert.equal(
      classifyPaymentOutcome({
        flowKind: "recurring",
        status: "failed",
        statusReason: "No valid mandate",
      }).reason,
      "status_reason_indicates_mandate_problem",
    );
  });

  it("classifies chargebacks, refunds, and reversals as review states", () => {
    assert.equal(
      classifyPaymentOutcome({
        flowKind: "recurring",
        hasChargeback: true,
        status: "paid",
      }).state,
      "charged_back",
    );
    assert.equal(
      classifyPaymentOutcome({
        flowKind: "recurring",
        hasRefundOrReversal: true,
        status: "paid",
      }).state,
      "reversed",
    );
  });

  it("maps plain recurring outcomes to existing persisted collection states", () => {
    assert.equal(
      classifyRecurringCollection({
        createdAt: "2026-06-01T10:00:00.000Z",
        hasChargeback: false,
        now: "2026-06-07T10:00:01.000Z",
        paymentType: "recurring",
        status: "pending",
      }),
      "failed_needs_review",
    );
    assert.equal(
      classifyRecurringCollection({
        hasChargeback: false,
        hasRefundOrReversal: true,
        paymentType: "recurring",
        status: "paid",
      }),
      "reversal_critical_review",
    );
  });
});

