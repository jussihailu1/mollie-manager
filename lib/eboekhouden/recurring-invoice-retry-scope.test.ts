import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const recurringSource = readFileSync(
  "lib/eboekhouden/recurring-invoices.ts",
  "utf8",
);
const retrySource = readFileSync(
  "lib/eboekhouden/recurring-invoice-retry.ts",
  "utf8",
);

describe("recurring invoice retry module boundary", () => {
  it("moves retry queue/report helpers out of the main recurring invoice file", () => {
    assert.match(recurringSource, /@\/lib\/eboekhouden\/recurring-invoice-retry/);
    assert.match(
      retrySource,
      /export async function getFailedRecurringInvoiceRetrySummary/,
    );
    assert.match(
      retrySource,
      /export async function queueRetryForFailedRecurringInvoicesBatch/,
    );
    assert.match(
      retrySource,
      /export async function queueRetryForSafeFailedRecurringInvoicesBatch/,
    );
    assert.doesNotMatch(retrySource, /getSingleTenantIdOrThrow/);
    assert.doesNotMatch(
      recurringSource,
      /export async function getFailedRecurringInvoiceRetrySummary/,
    );
    assert.doesNotMatch(
      recurringSource,
      /export async function queueRetryForFailedRecurringInvoicesBatch/,
    );
    assert.doesNotMatch(
      recurringSource,
      /export async function queueRetryForSafeFailedRecurringInvoicesBatch/,
    );
  });
});
