import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { deriveCustomerLifecycleState } from "@/lib/customer-lifecycle-state";

const now = new Date("2026-06-19T12:00:00.000Z");

describe("customer lifecycle state", () => {
  it("derives active when setup is complete and no issue exists", () => {
    assert.deepEqual(
      deriveCustomerLifecycleState(
        {
          eboekhoudenLinkStatus: "linked",
          hasValidMandate: true,
          latestPaymentStatus: "paid",
          latestSubscriptionStatus: "active",
        },
        { now },
      ),
      {
        reason: "active_subscription",
        state: "active",
        summary: "Customer has an active subscription.",
      },
    );
  });

  it("prioritizes payment issues over active subscription display", () => {
    const result = deriveCustomerLifecycleState(
      {
        eboekhoudenLinkStatus: "linked",
        hasValidMandate: true,
        latestPaymentStatus: "failed",
        latestPaymentType: "recurring",
        latestSubscriptionStatus: "active",
      },
      { now },
    );

    assert.equal(result.state, "payment_issue");
    assert.equal(result.reason, "payment_failed_or_reversed");
  });

  it("derives payment issue from subscription payment action state", () => {
    const result = deriveCustomerLifecycleState(
      {
        eboekhoudenLinkStatus: "linked",
        latestPaymentStatus: "paid",
        latestSubscriptionStatus: "payment_action_required",
      },
      { now },
    );

    assert.equal(result.state, "payment_issue");
    assert.equal(result.reason, "subscription_payment_action_required");
  });

  it("derives setup need for missing accounting relation", () => {
    const result = deriveCustomerLifecycleState(
      {
        eboekhoudenLinkStatus: "unlinked",
        hasValidMandate: true,
        latestPaymentStatus: "paid",
        latestSubscriptionStatus: "active",
      },
      { now },
    );

    assert.equal(result.state, "needs_setup");
    assert.equal(result.reason, "relation_missing_or_problem");
  });

  it("derives setup need for pending mandate or invalid active mandate", () => {
    assert.equal(
      deriveCustomerLifecycleState(
        {
          eboekhoudenLinkStatus: "linked",
          latestSubscriptionStatus: "mandate_pending",
        },
        { now },
      ).reason,
      "subscription_setup_pending",
    );

    assert.equal(
      deriveCustomerLifecycleState(
        {
          eboekhoudenLinkStatus: "linked",
          hasValidMandate: false,
          latestSubscriptionStatus: "active",
        },
        { now },
      ).reason,
      "mandate_missing_or_invalid",
    );
  });

  it("derives paused when future charges are stopped", () => {
    const result = deriveCustomerLifecycleState(
      {
        eboekhoudenLinkStatus: "linked",
        latestSubscriptionStatus: "future_charges_stopped",
      },
      { now },
    );

    assert.equal(result.state, "paused");
    assert.equal(result.reason, "future_charges_stopped");
  });

  it("derives ended before cancelled when the service end date is past", () => {
    const result = deriveCustomerLifecycleState(
      {
        archivedAt: "2026-06-18T12:00:00.000Z",
        latestSubscriptionServiceEndAt: "2026-06-18T12:00:00.000Z",
        latestSubscriptionStatus: "cancelled",
      },
      { now },
    );

    assert.equal(result.state, "ended");
    assert.equal(result.reason, "service_period_ended");
  });

  it("derives onboarding when there is onboarding evidence but no active subscription", () => {
    const result = deriveCustomerLifecycleState(
      {
        eboekhoudenLinkStatus: "linked",
        latestConsentAcceptedAt: "2026-06-19T10:00:00.000Z",
        latestFirstPaymentStatus: "open",
      },
      { now },
    );

    assert.equal(result.state, "onboarding");
    assert.equal(result.reason, "onboarding_in_progress");
  });
});
