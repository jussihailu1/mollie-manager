import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SAFE_INVOICE_RETRY_FAILURE_CODES } from "@/lib/eboekhouden/invoice-failure-retry";
import { buildInvoiceRetryQueuedMetadata } from "@/lib/eboekhouden/invoice-retry-metadata";

describe("invoice retry metadata helpers", () => {
  it("builds retry metadata with actor and stable queued timestamp", () => {
    assert.deepEqual(
      buildInvoiceRetryQueuedMetadata({
        actorEmail: "ops@example.test",
        queuedAt: "2026-06-09T10:00:00.000Z",
      }),
      {
        invoiceRetryQueuedAt: "2026-06-09T10:00:00.000Z",
        invoiceRetryQueuedBy: "ops@example.test",
      },
    );
  });

  it("can include safe retry failure-code evidence", () => {
    assert.deepEqual(
      buildInvoiceRetryQueuedMetadata({
        actorEmail: null,
        includeAllowedFailureCodes: true,
        queuedAt: "2026-06-09T10:00:00.000Z",
      }),
      {
        invoiceRetryAllowedFailureCodes: SAFE_INVOICE_RETRY_FAILURE_CODES,
        invoiceRetryQueuedAt: "2026-06-09T10:00:00.000Z",
        invoiceRetryQueuedBy: null,
      },
    );
  });
});
