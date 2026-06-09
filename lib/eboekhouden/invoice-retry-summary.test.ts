import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { countSafeInvoiceRetryFailures } from "@/lib/eboekhouden/invoice-retry-summary";

describe("invoice retry summary helpers", () => {
  it("counts retryable failures and total failures", () => {
    assert.deepEqual(
      countSafeInvoiceRetryFailures([
        { errorMessage: "e-Boekhouden rejected: FACT_014 Payment reference is too long." },
        { errorMessage: "Mutation failed: FACT_VERWERK_004 Payment reference already exists." },
        { errorMessage: "SECURITY_010 unauthorized" },
        { errorMessage: null },
      ]),
      {
        retryableCount: 2,
        totalFailedCount: 4,
      },
    );
  });
});
