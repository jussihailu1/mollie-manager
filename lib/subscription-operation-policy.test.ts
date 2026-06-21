import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decideSubscriptionOperation,
  type SubscriptionOperationPolicyInput,
} from "@/lib/subscription-operation-policy";

const baseInput = {
  asOf: "2026-07-01T00:00:00.000Z",
  cancellationEffect: "immediate",
  localStatus: "active",
  operation: "cancel",
  operatorReason: "Customer requested cancellation by email.",
  paidPeriodEndAt: null,
  providerStatus: "active",
  requestedEffectiveAt: "2026-07-01T00:00:00.000Z",
  serviceEndAt: null,
  termMode: "open_ended",
} satisfies SubscriptionOperationPolicyInput;

function decide(
  overrides: Partial<SubscriptionOperationPolicyInput> = {},
) {
  return decideSubscriptionOperation({ ...baseInput, ...overrides });
}

function assertDenied(
  decision: ReturnType<typeof decideSubscriptionOperation>,
  reasonCode: ReturnType<typeof decideSubscriptionOperation>["reasonCode"],
) {
  assert.deepEqual(decision, {
    allowed: false,
    billingEffect: { kind: "none", effectiveAt: null },
    existingCollectionStateEffect:
      "preserve_existing_invoice_and_payment_collection_state",
    providerMutationRequirement: "none",
    reasonCode,
    serviceEffect: { kind: "none", serviceEndAt: null },
  });
}

describe("subscription operation policy", () => {
  it("denies pause and resume because reversible provider operations are unsupported", () => {
    for (const operation of ["pause", "resume"] as const) {
      assertDenied(
        decide({ operation }),
        "provider_operation_unsupported",
      );
    }
  });

  it("denies cancellation for local, provider, and service terminal states", () => {
    assertDenied(
      decide({ localStatus: "future_charges_stopped" }),
      "terminal_state",
    );
    assertDenied(decide({ localStatus: "cancelled" }), "terminal_state");
    assertDenied(decide({ providerStatus: "canceled" }), "terminal_state");
    assertDenied(decide({ providerStatus: "completed" }), "terminal_state");
    assertDenied(
      decide({ serviceEndAt: "2026-07-01T00:00:00.000Z" }),
      "terminal_state",
    );
  });

  it("denies fixed-term cancellation while its policy is undefined", () => {
    assertDenied(
      decide({
        serviceEndAt: "2027-07-01T00:00:00.000Z",
        termMode: "fixed_term",
      }),
      "fixed_term_policy_undefined",
    );
  });

  it("requires a non-empty operator reason", () => {
    for (const operatorReason of ["", "   ", "\n\t"]) {
      assertDenied(
        decide({ operatorReason }),
        "operator_reason_required",
      );
    }
  });

  it("requires a valid requested effective date", () => {
    for (const requestedEffectiveAt of [
      "",
      "not-a-date",
      " 2026-07-01",
      "2026-02-31T00:00:00.000Z",
      "2026-07-01T00:00:00+02:00",
    ]) {
      assertDenied(
        decide({ requestedEffectiveAt }),
        "invalid_effective_date",
      );
    }
  });

  it("denies cancellation dates before the policy evaluation time", () => {
    assertDenied(
      decide({ requestedEffectiveAt: "2026-06-30T23:59:59.999Z" }),
      "effective_date_before_as_of",
    );
  });

  it("allows cancellation only when local and provider states are active", () => {
    assertDenied(
      decide({ localStatus: "payment_action_required" }),
      "subscription_not_active",
    );
    assertDenied(
      decide({ providerStatus: "suspended" }),
      "subscription_not_active",
    );
  });

  it("ends service at the requested date for immediate cancellation", () => {
    assert.deepEqual(decide(), {
      allowed: true,
      billingEffect: {
        kind: "stop_future_provider_charges",
        effectiveAt: "2026-07-01T00:00:00.000Z",
      },
      existingCollectionStateEffect:
        "preserve_existing_invoice_and_payment_collection_state",
      providerMutationRequirement: "cancel_provider_subscription_now",
      reasonCode: "operation_allowed",
      serviceEffect: {
        kind: "end_at_requested_effective_at",
        serviceEndAt: "2026-07-01T00:00:00.000Z",
      },
    });
  });

  it("requires a paid-period end for end-of-paid-period cancellation", () => {
    for (const paidPeriodEndAt of [null, "", "not-a-date"]) {
      assertDenied(
        decide({ cancellationEffect: "end_of_paid_period", paidPeriodEndAt }),
        "paid_period_end_required",
      );
    }
  });

  it("denies a paid-period end before the requested effective date", () => {
    assertDenied(
      decide({
        cancellationEffect: "end_of_paid_period",
        paidPeriodEndAt: "2026-06-30T23:59:59.999Z",
      }),
      "paid_period_end_before_effective_date",
    );
  });

  it("preserves service through an equal or later paid-period end", () => {
    for (const paidPeriodEndAt of [
      "2026-07-01T00:00:00.000Z",
      "2026-07-31T23:59:59.999Z",
    ]) {
      const decision = decide({
        cancellationEffect: "end_of_paid_period",
        paidPeriodEndAt,
      });

      assert.equal(decision.allowed, true);
      assert.deepEqual(decision.billingEffect, {
        kind: "stop_future_provider_charges",
        effectiveAt: "2026-07-01T00:00:00.000Z",
      });
      assert.equal(
        decision.providerMutationRequirement,
        "cancel_provider_subscription_now",
      );
      assert.deepEqual(decision.serviceEffect, {
        kind: "preserve_until_paid_period_end",
        serviceEndAt: paidPeriodEndAt,
      });
    }
  });

  it("requires scheduling instead of an early provider mutation for future cancellation", () => {
    const decision = decide({
      requestedEffectiveAt: "2026-07-15T00:00:00.000Z",
    });

    assert.equal(decision.allowed, true);
    assert.equal(
      decision.providerMutationRequirement,
      "schedule_provider_cancellation",
    );
    assert.deepEqual(decision.billingEffect, {
      kind: "stop_future_provider_charges",
      effectiveAt: "2026-07-15T00:00:00.000Z",
    });
  });

  it("never returns operator reason or provider payload data", () => {
    const sensitiveReason = "secret-token customer-private-note";
    const output = JSON.stringify(decide({ operatorReason: sensitiveReason }));

    assert.doesNotMatch(output, /secret-token|customer-private-note/);
    assert.equal("operatorReason" in decide(), false);
    assert.equal("providerPayload" in decide(), false);
  });
});
