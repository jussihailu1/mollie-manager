import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildFirstPaymentInvoiceReference,
  buildRecurringInvoiceReference,
  EBOEKHOUDEN_INVOICE_REFERENCE_MAX_LENGTH,
} from "@/lib/eboekhouden/invoice-reference";

describe("invoice reference guard", () => {
  it("builds first-payment reference below max length", () => {
    const reference = buildFirstPaymentInvoiceReference({
      invoiceDate: "2026-06-02",
      paymentId: "12345678-aaaa-bbbb-cccc-ddddeeeeffff",
    });

    assert.equal(reference, "FP-12345678-260602");
    assert.ok(reference.length <= EBOEKHOUDEN_INVOICE_REFERENCE_MAX_LENGTH);
  });

  it("builds recurring reference below max length", () => {
    const reference = buildRecurringInvoiceReference({
      plannedCollectionDate: "2026-09-26",
      scheduleId: "a136d64f-23a4-4633-ac74-60234b555618",
    });

    assert.equal(reference, "RB-a136d64f-260926");
    assert.ok(reference.length <= EBOEKHOUDEN_INVOICE_REFERENCE_MAX_LENGTH);
  });

  it("falls back to zero date when invoice date missing", () => {
    const reference = buildFirstPaymentInvoiceReference({
      invoiceDate: null,
      paymentId: "abcdef12-0000-0000-0000-000000000000",
    });

    assert.equal(reference, "FP-abcdef12-000000");
    assert.ok(reference.length <= EBOEKHOUDEN_INVOICE_REFERENCE_MAX_LENGTH);
  });
});
