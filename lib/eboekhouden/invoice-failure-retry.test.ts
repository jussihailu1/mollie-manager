import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isSafeInvoiceRetryFailure } from "@/lib/eboekhouden/invoice-failure-retry";

describe("safe invoice retry failure codes", () => {
  it("accepts known safe retry codes", () => {
    assert.equal(
      isSafeInvoiceRetryFailure("e-Boekhouden rejected: FACT_014 Payment reference is too long."),
      true,
    );
    assert.equal(
      isSafeInvoiceRetryFailure("Mutation failed: FACT_VERWERK_004 Payment reference already exists."),
      true,
    );
  });

  it("rejects unknown or missing failure codes", () => {
    assert.equal(isSafeInvoiceRetryFailure("SECURITY_010 unauthorized"), false);
    assert.equal(isSafeInvoiceRetryFailure(null), false);
  });
});
