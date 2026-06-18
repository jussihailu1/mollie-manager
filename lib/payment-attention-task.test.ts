import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { derivePaymentAttentionTask } from "@/lib/payment-attention-task";

describe("payment attention task helper", () => {
  it("keeps happy path and safe-pending payments out of needs attention", () => {
    assert.equal(
      derivePaymentAttentionTask({
        mollieStatus: "paid",
        paymentType: "recurring",
        recurringCollectionState: "settled",
      }),
      null,
    );
    assert.equal(
      derivePaymentAttentionTask({
        mollieStatus: "pending",
        paymentType: "recurring",
        recurringCollectionState: "pending_return_window",
      }),
      null,
    );
  });

  it("surfaces recurring failed collections without automated consequences", () => {
    const task = derivePaymentAttentionTask({
      mollieStatus: "failed",
      paymentType: "recurring",
      recurringCollectionState: "failed_needs_review",
    });

    assert.equal(task?.severity, "warning");
    assert.equal(task?.title, "Recurring payment needs review");
    assert.match(task?.safeNextAction ?? "", /Keep the existing invoice open/);
    assert.doesNotMatch(task?.safeNextAction ?? "", /cancel|fee|dunning/i);
  });

  it("surfaces mandate problems as critical manual review", () => {
    const task = derivePaymentAttentionTask({
      mollieStatus: "failed",
      paymentType: "recurring",
      recurringCollectionState: "mandate_problem_review",
    });

    assert.equal(task?.severity, "critical");
    assert.equal(task?.title, "Mandate problem");
    assert.match(task?.safeNextAction ?? "", /valid mandate/);
  });

  it("surfaces reversals and chargebacks as critical review", () => {
    const byState = derivePaymentAttentionTask({
      mollieStatus: "paid",
      paymentType: "recurring",
      recurringCollectionState: "reversal_critical_review",
    });
    const byDispute = derivePaymentAttentionTask({
      disputedAt: "2026-06-18T10:00:00.000Z",
      mollieStatus: "paid",
      paymentType: "first",
      recurringCollectionState: "not_applicable",
    });

    assert.equal(byState?.severity, "critical");
    assert.equal(byDispute?.severity, "critical");
    assert.match(byState?.summary ?? "", /invoice obligation may still be open/i);
  });
});

