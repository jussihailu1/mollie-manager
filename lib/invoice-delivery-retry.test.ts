import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getNextRetryAtIso,
  MAX_DELIVERY_ATTEMPTS,
  toInvoiceDeliveryAttemptCount,
} from "@/lib/invoice-delivery-retry";

describe("invoice delivery retry policy", () => {
  it("parses attempt count safely from metadata", () => {
    assert.equal(toInvoiceDeliveryAttemptCount({}), 0);
    assert.equal(toInvoiceDeliveryAttemptCount({ invoiceDeliveryAttemptCount: "2" }), 2);
    assert.equal(toInvoiceDeliveryAttemptCount({ invoiceDeliveryAttemptCount: 3.9 }), 3);
    assert.equal(toInvoiceDeliveryAttemptCount({ invoiceDeliveryAttemptCount: -5 }), 0);
  });

  it("calculates deterministic next retry timestamp from attempt", () => {
    const base = Date.UTC(2026, 0, 1, 0, 0, 0);
    assert.equal(getNextRetryAtIso(1, base), "2026-01-01T00:05:00.000Z");
    assert.equal(getNextRetryAtIso(2, base), "2026-01-01T00:15:00.000Z");
    assert.equal(
      getNextRetryAtIso(MAX_DELIVERY_ATTEMPTS + 5, base),
      "2026-01-08T00:00:00.000Z",
    );
  });
});
