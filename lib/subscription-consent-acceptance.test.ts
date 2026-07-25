import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSubscriptionConsentPath,
  findMissingRequiredConsentKey,
  parseConsentAcceptanceInput,
} from "@/lib/subscription-consent-acceptance";

describe("subscription consent acceptance helpers", () => {
  it("parses the single accepted subscription acknowledgment", () => {
    const parsed = parseConsentAcceptanceInput({
      subscriptionTermsAck: "on",
      token: "consent-token-123",
    });

    assert.deepEqual(parsed, {
      acknowledgedKeys: [
        "subscription_terms_ack",
      ],
      success: true,
      token: "consent-token-123",
    });
  });

  it("keeps invalid token available for redirect without accepting input", () => {
    const parsed = parseConsentAcceptanceInput({
      recurringTermsAck: "on",
      token: "short",
    });

    assert.deepEqual(parsed, {
      success: false,
      tokenForRedirect: "short",
    });
  });

  it("finds the first required checkbox not acknowledged", () => {
    assert.equal(
      findMissingRequiredConsentKey(
      [
          "subscription_terms_ack",
        ],
        [],
      ),
      "subscription_terms_ack",
    );
    assert.equal(
      findMissingRequiredConsentKey(
        ["recurring_terms_ack"],
        ["recurring_terms_ack", "cancellation_policy_ack"],
      ),
      undefined,
    );
  });

  it("builds consent redirect paths with encoded error params", () => {
    assert.equal(
      buildSubscriptionConsentPath("token12345", {
        error: "consent_required",
      }),
      "/subscribe/token12345?error=consent_required",
    );
    assert.equal(buildSubscriptionConsentPath("token12345"), "/subscribe/token12345");
  });
});
