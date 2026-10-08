import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertEboekhoudenInvoiceTotal } from "@/lib/eboekhouden/invoice-total-validation";

describe("e-Boekhouden invoice total verification", () => {
  it("rejects missing, coerced or fractional-cent provider amounts", () => {
    for (const vatAmount of [null, "", false, "0", NaN, Infinity, 0.001]) {
      assert.throws(() => assertEboekhoudenInvoiceTotal({
        expectedAmount: "19.99",
        invoice: { totalAmount: 19.99, vatAmount: vatAmount as number },
        taxTreatment: "kor",
      }), /invalid invoice amount/);
    }
    assert.throws(() => assertEboekhoudenInvoiceTotal({ expectedAmount: "19.991", invoice: { totalAmount: 19.99, vatAmount: 0 }, taxTreatment: "kor" }), /exactly two decimal places/);
  });
  it("rejects the observed €19.99 payment / €24.19 invoice mismatch", () => {
    assert.throws(() => assertEboekhoudenInvoiceTotal({
      expectedAmount: "19.99",
      invoice: { totalAmount: 24.19, vatAmount: 4.20 },
      taxTreatment: "kor",
    }), /differs from the Mollie subscription amount/);
  });

  it("accepts a matching KOR invoice and rejects tax on a matching total", () => {
    assert.doesNotThrow(() => assertEboekhoudenInvoiceTotal({
      expectedAmount: "19.99",
      invoice: { totalAmount: 19.99, vatAmount: 0 },
      taxTreatment: "kor",
    }));
    assert.throws(() => assertEboekhoudenInvoiceTotal({
      expectedAmount: "19.99",
      invoice: { totalAmount: 19.99, vatAmount: 3.47 },
      taxTreatment: "kor",
    }), /contains VAT/);
  });

  it("requires 21% VAT inside the agreed price for standard treatment", () => {
    assert.doesNotThrow(() => assertEboekhoudenInvoiceTotal({
      expectedAmount: "19.99",
      invoice: { totalAmount: 19.99, vatAmount: 3.47 },
      taxTreatment: "standard",
    }));
    assert.throws(() => assertEboekhoudenInvoiceTotal({
      expectedAmount: "19.99",
      invoice: { totalAmount: 19.99, vatAmount: 0 },
      taxTreatment: "standard",
    }), /VAT differs/);
  });
});
