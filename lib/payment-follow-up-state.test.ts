import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  derivePaymentFollowUpState,
  type PaymentFollowUpStateInput,
} from "@/lib/payment-follow-up-state";

function buildInput(
  overrides: Partial<PaymentFollowUpStateInput> = {},
): PaymentFollowUpStateInput {
  return {
    alertStatus: "open",
    attemptCount: 1,
    claimedAt: null,
    failedAt: null,
    notificationStatus: "absent",
    sentAt: null,
    ...overrides,
  };
}

describe("failed payment follow-up presentation", () => {
  it("keeps open and acknowledged alerts as operator work", () => {
    for (const alertStatus of ["open", "acknowledged"] as const) {
      const result = derivePaymentFollowUpState(buildInput({ alertStatus }));

      assert.equal(result.taskStatus, "operator_work");
      assert.equal(result.taskLabel, "Operator follow-up required");
    }
  });

  it("marks only resolved alerts as completed", () => {
    const resolved = derivePaymentFollowUpState(
      buildInput({ alertStatus: "resolved", notificationStatus: "sent" }),
    );
    const absent = derivePaymentFollowUpState(
      buildInput({ alertStatus: "absent", notificationStatus: "sent" }),
    );

    assert.equal(resolved.taskStatus, "completed");
    assert.equal(resolved.taskLabel, "Follow-up completed");
    assert.equal(resolved.urgency, "none");
    assert.equal(absent.taskStatus, "untracked");
    assert.equal(absent.taskLabel, "No follow-up task");
  });

  it("maps delivery states to stable operator-facing evidence", () => {
    const expected = {
      claimed: ["delivery_in_progress", "Delivery in progress"],
      sent: ["customer_notified", "Customer notified"],
      failed: ["delivery_failed", "Notification failed"],
      skipped: ["delivery_skipped", "Notification skipped"],
      absent: ["no_delivery_evidence", "No delivery evidence"],
    } as const;

    for (const [notificationStatus, presentation] of Object.entries(expected)) {
      const result = derivePaymentFollowUpState(
        buildInput({
          notificationStatus:
            notificationStatus as PaymentFollowUpStateInput["notificationStatus"],
        }),
      );

      assert.equal(result.notificationStatus, presentation[0]);
      assert.equal(result.notificationLabel, presentation[1]);
    }
  });

  it("treats a claimed notification as delivery in progress", () => {
    const result = derivePaymentFollowUpState(
      buildInput({
        alertStatus: "acknowledged",
        claimedAt: "2026-06-21T09:00:00.000Z",
        notificationStatus: "claimed",
      }),
    );

    assert.equal(result.urgency, "medium");
    assert.match(result.recommendedAction, /Confirm delivery completes/i);
  });

  it("confirms sent delivery without exposing delivery metadata", () => {
    const sentAt = "2026-06-21T10:00:00.000Z";
    const result = derivePaymentFollowUpState(
      buildInput({
        attemptCount: 7,
        notificationStatus: "sent",
        sentAt,
      }),
    );

    assert.equal(result.notificationStatus, "customer_notified");
    assert.match(result.recommendedAction, /recorded as sent/i);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(sentAt));
    assert.doesNotMatch(JSON.stringify(result), /7/);
  });

  it("recommends settings and manual-contact review after delivery failure", () => {
    const result = derivePaymentFollowUpState(
      buildInput({
        attemptCount: 3,
        failedAt: "2026-06-21T10:00:00.000Z",
        notificationStatus: "failed",
      }),
    );

    assert.equal(result.urgency, "high");
    assert.match(result.recommendedAction, /email settings/i);
    assert.match(result.recommendedAction, /contact details/i);
    assert.match(result.recommendedAction, /manual customer contact/i);
    assert.doesNotMatch(
      result.recommendedAction,
      /auto.?retry|fee|cancel|dun/i,
    );
  });

  it("states that an absent notification has no delivery evidence", () => {
    const result = derivePaymentFollowUpState(
      buildInput({ notificationStatus: "absent" }),
    );

    assert.equal(result.notificationStatus, "no_delivery_evidence");
    assert.match(result.recommendedAction, /no delivery evidence/i);
  });

  it("never returns customer content, delivery details, or payload fields", () => {
    const result = derivePaymentFollowUpState(
      buildInput({ notificationStatus: "failed" }),
    );

    assert.deepEqual(Object.keys(result).sort(), [
      "notificationLabel",
      "notificationStatus",
      "recommendedAction",
      "taskLabel",
      "taskStatus",
      "urgency",
    ]);
  });
});
