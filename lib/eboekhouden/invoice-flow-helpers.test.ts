import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isEboekhoudenReferenceAlreadyExistsError,
  serializeInvoiceErrorMessage,
  toInvoiceAmountNumber,
  toInvoiceCount,
  toInvoiceDateString,
} from "@/lib/eboekhouden/invoice-flow-helpers";

describe("invoice flow helpers", () => {
  it("normalizes count and amount values from database rows", () => {
    assert.equal(toInvoiceCount(3), 3);
    assert.equal(toInvoiceCount("4"), 4);
    assert.equal(toInvoiceCount(null), 0);
    assert.equal(toInvoiceAmountNumber("12.345"), 12.35);
  });

  it("serializes errors and dates safely", () => {
    assert.equal(toInvoiceDateString("2026-06-08T10:00:00.000Z"), "2026-06-08");
    assert.equal(toInvoiceDateString(null), null);
    assert.equal(
      serializeInvoiceErrorMessage(new Error("upstream failed"), "fallback"),
      "upstream failed",
    );
    assert.equal(serializeInvoiceErrorMessage("bad", "fallback"), "fallback");
  });

  it("detects e-Boekhouden duplicate reference failures", () => {
    assert.equal(
      isEboekhoudenReferenceAlreadyExistsError(
        new Error("FACT_VERWERK_004 reference already exists"),
      ),
      true,
    );
    assert.equal(
      isEboekhoudenReferenceAlreadyExistsError(new Error("FACT_014 duplicate")),
      true,
    );
    assert.equal(
      isEboekhoudenReferenceAlreadyExistsError(new Error("network timeout")),
      false,
    );
  });
});
