import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildInvoiceStateDeltaSummary,
  parseReconciliationSummary,
  serializeReconciliationSummary,
} from "@/lib/reliability/reconciliation-summary";

describe("reconciliation summary helpers", () => {
  it("captures only changed invoice states while preserving totals", () => {
    const summary = buildInvoiceStateDeltaSummary(
      ["pending_invoice", "invoice_created", "invoice_failed"] as const,
      {
        invoice_created: 1,
        pending_invoice: 3,
      },
      {
        invoice_created: 3,
        invoice_failed: 1,
      },
    );

    assert.deepEqual(summary.changed, [
      {
        after: 0,
        before: 3,
        delta: -3,
        state: "pending_invoice",
      },
      {
        after: 3,
        before: 1,
        delta: 2,
        state: "invoice_created",
      },
      {
        after: 1,
        before: 0,
        delta: 1,
        state: "invoice_failed",
      },
    ]);
    assert.equal(summary.totalBefore, 4);
    assert.equal(summary.totalAfter, 4);
    assert.equal(summary.totalDelta, 0);
  });

  it("round-trips reconciliation summaries through the redirect payload codec", () => {
    const encoded = serializeReconciliationSummary({
      firstPaymentInvoiceStateDelta: {
        changed: [
          {
            after: 2,
            before: 0,
            delta: 2,
            state: "invoice_created",
          },
        ],
        totalAfter: 2,
        totalBefore: 0,
        totalDelta: 2,
      },
      firstPaymentsChecked: 4,
      mode: "live",
      paymentLinksChecked: 3,
      ranAt: "2026-06-07T09:10:11.000Z",
      reconciliationMode: "full",
      recurringInvoiceStateDelta: {
        changed: [],
        totalAfter: 5,
        totalBefore: 5,
        totalDelta: 0,
      },
      subscriptionsChecked: 6,
    });

    assert.deepEqual(parseReconciliationSummary(encoded), {
      firstPaymentInvoiceStateDelta: {
        changed: [
          {
            after: 2,
            before: 0,
            delta: 2,
            state: "invoice_created",
          },
        ],
        totalAfter: 2,
        totalBefore: 0,
        totalDelta: 2,
      },
      firstPaymentsChecked: 4,
      mode: "live",
      paymentLinksChecked: 3,
      ranAt: "2026-06-07T09:10:11.000Z",
      reconciliationMode: "full",
      recurringInvoiceStateDelta: {
        changed: [],
        totalAfter: 5,
        totalBefore: 5,
        totalDelta: 0,
      },
      subscriptionsChecked: 6,
    });
  });

  it("rejects invalid redirect payloads", () => {
    assert.equal(parseReconciliationSummary("not-valid"), null);
  });
});
