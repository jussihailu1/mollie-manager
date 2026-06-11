import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PaymentMethod, SequenceType } from "@mollie/api-client";

import { buildConsentTokenStorage } from "@/lib/onboarding/consent-token-storage";
import { buildFirstPaymentOnboardingRecords } from "@/lib/onboarding/first-payment-onboarding-records";

process.env.AUTH_SECRET ??= "test-auth-secret-00000000000000000000";

describe("first payment onboarding records", () => {
  it("builds non-secret payment and consent insert payloads", () => {
    const consentTokenStorage = buildConsentTokenStorage("token-123");
    const records = buildFirstPaymentOnboardingRecords({
      consentTokenStorage,
      customerId: "cust_123",
      fallbackAmountValue: "25.00",
      firstPaymentMode: "real_installment",
      localConsentId: "consent_123",
      localPaymentLinkId: "plink_123",
      mollieCustomerId: "cst_123",
      paymentLink: {
        allowedMethods: [PaymentMethod.ideal],
        createdAt: "2026-06-01T10:00:00Z",
        description: "First payment",
        expiresAt: "2026-07-01T10:00:00Z",
        getPaymentUrl: () => "https://example.test/pay",
        id: "pl_123",
        reusable: false,
        sequenceType: SequenceType.first,
      },
      planSnapshot: {
        firstPaymentAmountValue: "25.00",
      } as never,
      redirectUrl: "https://app.test/subscribe/token/return",
      selectedMode: "live",
      termsVersion: "2026-06",
    });

    assert.equal(records.paymentLinkRecord.molliePaymentLinkId, "pl_123");
    assert.equal(records.paymentLinkRecord.amountValue, "25.00");
    assert.equal(
      records.paymentLinkRecord.metadata.redirectUrl,
      "https://app.test/subscribe/token/return",
    );
    assert.equal(records.paymentLinkRecord.metadata.source, "subscription_onboarding");
    assert.equal(records.consentRecord.consentToken, null);
    assert.equal(records.consentRecord.consentTokenHash, consentTokenStorage.consentTokenHash);
    assert.deepEqual(records.consentRecord.requiredCheckboxKeys, [
      "recurring_terms_ack",
      "recurring_billing_policy_ack",
      "cancellation_policy_ack",
    ]);
    assert.equal(records.auditDetails.localPaymentLinkId, "plink_123");
  });
});
