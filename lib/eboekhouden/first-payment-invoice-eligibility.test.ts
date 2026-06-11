import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeFirstPaymentInvoiceEligibility,
  type FirstPaymentInvoiceEligibilityCandidate,
} from "@/lib/eboekhouden/first-payment-invoice-eligibility";

describe("first-payment invoice eligibility", () => {
  const baseCandidate: FirstPaymentInvoiceEligibilityCandidate = {
    consentAcceptedAt: "2026-06-11T08:00:00.000Z",
    eboekhoudenRelationId: 123,
    firstPaymentMode: "real_installment",
  };

  it("skips missing matches and missing accounting links", () => {
    assert.equal(describeFirstPaymentInvoiceEligibility(null).status, "skipped");
    const missingRelation = describeFirstPaymentInvoiceEligibility({
      ...baseCandidate,
      eboekhoudenRelationId: null,
    });
    assert.equal(missingRelation.status, "skipped");
    if (missingRelation.status === "skipped") {
      assert.equal(
        missingRelation.reason,
        "Customer is not linked to an e-Boekhouden relation. Link the customer before creating the invoice.",
      );
    }
  });

  it("skips unaccepted consent and mandate-only first payments", () => {
    const missingConsent = describeFirstPaymentInvoiceEligibility({
      ...baseCandidate,
      consentAcceptedAt: null,
    });
    assert.equal(missingConsent.status, "skipped");
    if (missingConsent.status === "skipped") {
      assert.equal(
        missingConsent.reason,
        "The matched onboarding consent is not accepted yet.",
      );
    }

    const mandateOnly = describeFirstPaymentInvoiceEligibility({
      ...baseCandidate,
      firstPaymentMode: "mandate_only",
    });
    assert.equal(mandateOnly.status, "skipped");
    if (mandateOnly.status === "skipped") {
      assert.equal(
        mandateOnly.reason,
        "Mandate-only first payments must not create a normal invoice.",
      );
    }
  });

  it("marks real-installment candidates as eligible", () => {
    assert.equal(describeFirstPaymentInvoiceEligibility(baseCandidate).status, "eligible");
  });
});
