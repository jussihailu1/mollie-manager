import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  runAcceptSubscriptionConsentFlow,
  type AcceptSubscriptionConsentFlowDependencies,
  type MarkSubscriptionConsentAcceptedInput,
} from "@/lib/subscription-consent-flow";

function createDependencies(
  overrides: Partial<AcceptSubscriptionConsentFlowDependencies> = {},
) {
  const accepted: MarkSubscriptionConsentAcceptedInput[] = [];
  const dependencies: AcceptSubscriptionConsentFlowDependencies = {
    getConsentByToken: async () => ({
      acceptedAt: null,
      checkoutUrl: "https://checkout.test/pay",
      consentId: "consent_1",
      requiredCheckboxKeys: [
        "recurring_terms_ack",
        "recurring_billing_policy_ack",
      ],
    }),
    markConsentAccepted: async (input) => {
      accepted.push(input);
    },
    ...overrides,
  };

  return {
    accepted,
    dependencies,
  };
}

describe("subscription consent acceptance flow", () => {
  it("redirects invalid form input without loading consent", async () => {
    let loaded = false;
    const { accepted, dependencies } = createDependencies({
      getConsentByToken: async () => {
        loaded = true;
        return null;
      },
    });

    const result = await runAcceptSubscriptionConsentFlow(
      {
        acceptedIp: null,
        acceptedUserAgent: null,
        formInput: {
          token: "short",
        },
      },
      dependencies,
    );

    assert.deepEqual(result, {
      redirectTo: "/subscribe/short?error=consent_form_invalid",
      status: "consent_form_invalid",
    });
    assert.equal(loaded, false);
    assert.deepEqual(accepted, []);
  });

  it("redirects missing consent to the invalid-link error", async () => {
    const { accepted, dependencies } = createDependencies({
      getConsentByToken: async () => null,
    });

    const result = await runAcceptSubscriptionConsentFlow(
      {
        acceptedIp: null,
        acceptedUserAgent: null,
        formInput: {
          token: "consent-token-123",
        },
      },
      dependencies,
    );

    assert.deepEqual(result, {
      redirectTo: "/subscribe/consent-token-123?error=consent_not_found",
      status: "consent_not_found",
    });
    assert.deepEqual(accepted, []);
  });

  it("redirects consent records without checkout urls", async () => {
    const { dependencies } = createDependencies({
      getConsentByToken: async () => ({
        acceptedAt: null,
        checkoutUrl: null,
        consentId: "consent_1",
        requiredCheckboxKeys: [],
      }),
    });

    const result = await runAcceptSubscriptionConsentFlow(
      {
        acceptedIp: null,
        acceptedUserAgent: null,
        formInput: {
          token: "consent-token-123",
        },
      },
      dependencies,
    );

    assert.deepEqual(result, {
      redirectTo: "/subscribe/consent-token-123?error=checkout_missing",
      status: "checkout_missing",
    });
  });

  it("redirects already accepted consent directly to checkout", async () => {
    const { accepted, dependencies } = createDependencies({
      getConsentByToken: async () => ({
        acceptedAt: "2026-06-08T10:00:00.000Z",
        checkoutUrl: "https://checkout.test/pay",
        consentId: "consent_1",
        requiredCheckboxKeys: ["recurring_terms_ack"],
      }),
    });

    const result = await runAcceptSubscriptionConsentFlow(
      {
        acceptedIp: null,
        acceptedUserAgent: null,
        formInput: {
          token: "consent-token-123",
        },
      },
      dependencies,
    );

    assert.deepEqual(result, {
      redirectTo: "https://checkout.test/pay",
      status: "already_accepted",
    });
    assert.deepEqual(accepted, []);
  });

  it("requires all required checkboxes before accepting consent", async () => {
    const { accepted, dependencies } = createDependencies();

    const result = await runAcceptSubscriptionConsentFlow(
      {
        acceptedIp: null,
        acceptedUserAgent: null,
        formInput: {
          recurringTermsAck: "on",
          token: "consent-token-123",
        },
      },
      dependencies,
    );

    assert.deepEqual(result, {
      redirectTo: "/subscribe/consent-token-123?error=consent_required",
      status: "consent_required",
    });
    assert.deepEqual(accepted, []);
  });

  it("marks consent accepted and redirects to checkout when requirements pass", async () => {
    const { accepted, dependencies } = createDependencies();

    const result = await runAcceptSubscriptionConsentFlow(
      {
        acceptedIp: "203.0.113.10",
        acceptedUserAgent: "Mozilla/5.0",
        formInput: {
          recurringBillingPolicyAck: "on",
          recurringTermsAck: "on",
          token: "consent-token-123",
        },
      },
      dependencies,
    );

    assert.deepEqual(result, {
      redirectTo: "https://checkout.test/pay",
      status: "accepted",
    });
    assert.deepEqual(accepted, [
      {
        acceptedCheckboxKeys: [
          "recurring_terms_ack",
          "recurring_billing_policy_ack",
        ],
        acceptedIp: "203.0.113.10",
        acceptedUserAgent: "Mozilla/5.0",
        consentId: "consent_1",
      },
    ]);
  });

  it("accepts the single acknowledgment required by new consent links", async () => {
    const { accepted, dependencies } = createDependencies({
      getConsentByToken: async () => ({
        acceptedAt: null,
        checkoutUrl: "https://checkout.test/pay",
        consentId: "consent_1",
        requiredCheckboxKeys: ["subscription_terms_ack"],
      }),
    });

    const result = await runAcceptSubscriptionConsentFlow(
      {
        acceptedIp: null,
        acceptedUserAgent: null,
        formInput: {
          subscriptionTermsAck: "on",
          token: "consent-token-123",
        },
      },
      dependencies,
    );

    assert.deepEqual(result, {
      redirectTo: "https://checkout.test/pay",
      status: "accepted",
    });
    assert.deepEqual(accepted[0]?.acceptedCheckboxKeys, ["subscription_terms_ack"]);
  });
});
