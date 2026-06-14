import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const firstPaymentSource = readFileSync(
  "lib/eboekhouden/first-payment-invoices.ts",
  "utf8",
);
const retrySource = readFileSync(
  "lib/eboekhouden/first-payment-invoice-retry.ts",
  "utf8",
);

describe("first-payment invoice retry module boundary", () => {
  it("moves retry queue/report helpers out of the main invoice file", () => {
    assert.match(firstPaymentSource, /@\/lib\/eboekhouden\/first-payment-invoice-retry/);
    assert.match(
      retrySource,
      /export async function queueRetryForSafeFailedFirstPaymentInvoicesBatch/,
    );
    assert.match(
      retrySource,
      /export async function getFailedFirstPaymentInvoiceRetrySummary/,
    );
    assert.match(
      retrySource,
      /export async function queueRetryForFailedFirstPaymentInvoicesBatch/,
    );
    assert.doesNotMatch(
      firstPaymentSource,
      /export async function queueRetryForSafeFailedFirstPaymentInvoicesBatch/,
    );
    assert.doesNotMatch(
      firstPaymentSource,
      /export async function getFailedFirstPaymentInvoiceRetrySummary/,
    );
    assert.doesNotMatch(
      firstPaymentSource,
      /export async function queueRetryForFailedFirstPaymentInvoicesBatch/,
    );
  });
});
