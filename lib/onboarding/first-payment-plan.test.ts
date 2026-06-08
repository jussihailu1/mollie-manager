import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildFirstPaymentPlan,
  normalizeSubscriptionAmountValue,
  validateFirstPaymentTermInput,
} from "@/lib/onboarding/first-payment-plan";
import type { TenantSubscriptionPolicyDefaults } from "@/lib/subscription-policy";

const tenantPolicy = {
  cancellationEmail: "billing@example.test",
  defaultCancellationEffect: "end_of_paid_period",
  privacyUrl: "https://example.test/privacy",
  termsUrl: "https://example.test/terms",
  termsVersion: "2026-06",
} satisfies TenantSubscriptionPolicyDefaults;

describe("first payment plan helpers", () => {
  it("normalizes comma amounts to two-decimal Mollie values", () => {
    assert.equal(normalizeSubscriptionAmountValue("12,5"), "12.50");
    assert.equal(normalizeSubscriptionAmountValue("12.34"), "12.34");
    assert.throws(
      () => normalizeSubscriptionAmountValue("12.345"),
      /Enter a valid amount using up to two decimals\./,
    );
  });

  it("rejects invalid fixed-term totals before side effects", () => {
    assert.throws(
      () =>
        validateFirstPaymentTermInput({
          firstPaymentMode: "real_installment",
          subscriptionTermMode: "fixed_term",
          totalPayments: 1,
        }),
      /at least 2 total payments/,
    );
    assert.throws(
      () =>
        validateFirstPaymentTermInput({
          firstPaymentMode: "mandate_only",
          subscriptionTermMode: "fixed_term",
          totalPayments: null,
        }),
      /Total payments is required/,
    );
  });

  it("builds real-installment consent plan and first payment amount", () => {
    const plan = buildFirstPaymentPlan({
      firstPaymentMode: "real_installment",
      serviceEndAt: "",
      subscriptionAmountValue: "25",
      subscriptionDescription: "Monthly service",
      subscriptionInterval: "monthly",
      subscriptionStartDate: "2026-07-01",
      subscriptionTermMode: "fixed_term",
      tenantPolicy,
      totalPayments: 3,
    });

    assert.equal(plan.amountValue, "25.00");
    assert.equal(plan.paymentDescription, "Monthly service");
    assert.equal(plan.planSnapshot.firstPaymentAmountValue, "25.00");
    assert.equal(plan.planSnapshot.recurringChargeCount, 2);
    assert.equal(plan.planSnapshot.finalChargeDate, "2026-08-01");
    assert.equal(plan.planSnapshot.serviceEndAt, "2026-09-01T00:00:00.000Z");
  });

  it("builds mandate-only setup payment plan", () => {
    const plan = buildFirstPaymentPlan({
      firstPaymentMode: "mandate_only",
      subscriptionAmountValue: "99.95",
      subscriptionDescription: "Annual service",
      subscriptionInterval: "yearly",
      subscriptionStartDate: "2026-07-01",
      subscriptionTermMode: "open_ended",
      tenantPolicy,
      totalPayments: 9,
    });

    assert.equal(plan.amountValue, "0.01");
    assert.equal(plan.paymentDescription, "Mandate setup payment");
    assert.equal(plan.planSnapshot.totalPayments, null);
    assert.equal(plan.planSnapshot.recurringChargeCount, null);
  });
});
