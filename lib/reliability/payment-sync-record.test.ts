import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPaymentSyncMetadata,
  deriveCollectionReviewRequiredAt,
  derivePaymentRecurringCollectionState,
  hasPaymentChargeback,
  resolveFirstPaymentMode,
  resolvePaymentSyncType,
  serializePaymentStatusReason,
} from "@/lib/reliability/payment-sync-record";

describe("payment sync record helpers", () => {
  it("classifies payment type from subscription and sequence data", () => {
    assert.equal(resolvePaymentSyncType({ status: "paid", subscriptionId: "sub_1" }), "recurring");
    assert.equal(resolvePaymentSyncType({ sequenceType: "recurring", status: "paid" }), "recurring");
    assert.equal(resolvePaymentSyncType({ sequenceType: "first", status: "paid" }), "first");
    assert.equal(resolvePaymentSyncType({ status: "paid" }), "manual");
  });

  it("serializes status reasons and detects chargebacks", () => {
    assert.equal(serializePaymentStatusReason("bank refused"), "bank refused");
    assert.equal(
      serializePaymentStatusReason({ code: "AM04", message: "Insufficient funds" }),
      "AM04: Insufficient funds",
    );
    assert.equal(serializePaymentStatusReason(null), null);
    assert.equal(
      hasPaymentChargeback({
        amountChargedBack: { value: "1.00" },
        status: "paid",
      }),
      true,
    );
    assert.equal(
      hasPaymentChargeback({
        amountChargedBack: { value: "0.00" },
        status: "paid",
      }),
      false,
    );
  });

  it("derives recurring collection review state and review timestamp", () => {
    assert.equal(
      derivePaymentRecurringCollectionState({
        amountChargedBack: { value: "5.00" },
        sequenceType: "recurring",
        status: "paid",
      }),
      "reversal_critical_review",
    );
    assert.equal(
      derivePaymentRecurringCollectionState({
        sequenceType: "recurring",
        status: "failed",
        statusReason: "mandate invalid",
      }),
      "mandate_problem_review",
    );
    assert.equal(
      deriveCollectionReviewRequiredAt(
        "failed_needs_review",
        "2026-06-08T10:00:00.000Z",
      ),
      "2026-06-08T10:00:00.000Z",
    );
    assert.equal(
      deriveCollectionReviewRequiredAt(
        "pending_return_window",
        "2026-06-08T10:00:00.000Z",
      ),
      null,
    );
  });

  it("builds persisted payment metadata and resolves first-payment mode", () => {
    assert.deepEqual(
      buildPaymentSyncMetadata({
        payment: {
          description: "Recurring subscription payment",
          redirectUrl: "https://checkout.test",
          status: "failed",
          statusReason: { code: "AM04", message: "Insufficient funds" },
        },
        paymentType: "recurring",
      }),
      {
        description: "Recurring subscription payment",
        recurringBillingPolicy: {
          sepaPendingReturnWindowDays: 5,
        },
        redirectUrl: "https://checkout.test",
        statusReason: "AM04: Insufficient funds",
      },
    );
    assert.equal(resolveFirstPaymentMode({ firstPaymentMode: "mandate_only" }), "mandate_only");
    assert.equal(resolveFirstPaymentMode({}), "real_installment");
  });
});
