import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveFirstPaymentInvoiceDate } from "@/lib/eboekhouden/first-payment-invoice-date";

describe("first-payment invoice date", () => {
  it("prefers the paid date and falls back to the creation date", () => {
    assert.equal(
      resolveFirstPaymentInvoiceDate({
        paidAt: "2026-06-11T08:15:00.000Z",
        paymentCreatedAt: "2026-06-10T08:15:00.000Z",
      }),
      "2026-06-11",
    );
    assert.equal(
      resolveFirstPaymentInvoiceDate({
        paidAt: null,
        paymentCreatedAt: "2026-06-10T08:15:00.000Z",
      }),
      "2026-06-10",
    );
  });

  it("returns null when neither date can be converted", () => {
    assert.equal(
      resolveFirstPaymentInvoiceDate({
        paidAt: null,
        paymentCreatedAt: "",
      }),
      null,
    );
  });
});
