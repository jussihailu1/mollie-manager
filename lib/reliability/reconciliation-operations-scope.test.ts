import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const syncSource = readFileSync("lib/reliability/sync.ts", "utf8");
const operationsSource = readFileSync(
  "lib/reliability/reconciliation-operations.ts",
  "utf8",
);

describe("reconciliation operations module boundary", () => {
  it("keeps reconciliation counts and orchestration out of the main sync file", () => {
    assert.match(syncSource, /@\/lib\/reliability\/reconciliation-operations/);
    assert.doesNotMatch(syncSource, /getFirstPaymentInvoiceStateCounts/);
    assert.doesNotMatch(syncSource, /getRecurringInvoiceStateCounts/);
    assert.match(operationsSource, /export async function reconcileOperationalData/);
    assert.match(operationsSource, /getFirstPaymentInvoiceStateCounts/);
    assert.match(operationsSource, /getRecurringInvoiceStateCounts/);
    assert.match(operationsSource, /buildInvoiceStateDeltaSummary/);
  });
});
