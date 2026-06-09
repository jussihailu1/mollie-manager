import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { filterSafeFailedInvoiceRetryIds } from "@/lib/eboekhouden/invoice-retry-candidates";

describe("invoice retry candidate helpers", () => {
  it("keeps only retryable failed ids", () => {
    assert.deepEqual(
      filterSafeFailedInvoiceRetryIds([
        { errorMessage: "e-Boekhouden rejected: FACT_014 Payment reference is too long.", id: "p1" },
        { errorMessage: "Mutation failed: FACT_VERWERK_004 Payment reference already exists.", id: "p2" },
        { errorMessage: "SECURITY_010 unauthorized", id: "p3" },
        { errorMessage: null, id: "p4" },
      ]),
      ["p1", "p2"],
    );
  });
});
