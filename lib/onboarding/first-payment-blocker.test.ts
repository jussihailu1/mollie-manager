import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveFirstPaymentCreationBlocker } from "@/lib/onboarding/first-payment-blocker";

describe("first payment creation blocker", () => {
  it("blocks when a paid first payment already exists", () => {
    assert.equal(
      resolveFirstPaymentCreationBlocker({
        paymentLinks: [],
        payments: [{ mollieStatus: "paid", paymentType: "first" }],
      }),
      "A paid first payment already exists for this customer.",
    );
  });

  it("blocks non-renewable first payments before payment links", () => {
    assert.equal(
      resolveFirstPaymentCreationBlocker({
        paymentLinks: [{ mollieStatus: "open" }],
        payments: [{ mollieStatus: "open", paymentType: "first" }],
      }),
      "A first payment already exists for this customer. Reuse or sync it before creating another one.",
    );
  });

  it("allows failed first payments and failed links to be replaced", () => {
    assert.equal(
      resolveFirstPaymentCreationBlocker({
        paymentLinks: [{ mollieStatus: "failed" }],
        payments: [{ mollieStatus: "failed", paymentType: "first" }],
      }),
      null,
    );
  });

  it("blocks active payment links when no payment blocks creation", () => {
    assert.equal(
      resolveFirstPaymentCreationBlocker({
        paymentLinks: [{ mollieStatus: "open" }],
        payments: [{ mollieStatus: "paid", paymentType: "manual" }],
      }),
      "A first payment link already exists for this customer. Reuse or sync it before creating another one.",
    );
  });
});
