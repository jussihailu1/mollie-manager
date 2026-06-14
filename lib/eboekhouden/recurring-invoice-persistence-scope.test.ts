import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const invoiceSource = readFileSync("lib/eboekhouden/recurring-invoices.ts", "utf8");
const workflowSource = readFileSync(
  "lib/eboekhouden/recurring-invoice-workflow.ts",
  "utf8",
);
const persistenceSource = readFileSync(
  "lib/eboekhouden/recurring-invoice-persistence.ts",
  "utf8",
);

describe("recurring invoice persistence module boundary", () => {
  it("keeps claim and store helpers inside persistence module instead of workflow/main files", () => {
    assert.match(
      workflowSource,
      /@\/lib\/eboekhouden\/recurring-invoice-persistence/,
    );
    assert.match(
      persistenceSource,
      /export async function claimScheduleForInvoice/,
    );
    assert.match(
      persistenceSource,
      /export async function storeRecurringInvoiceCreationSuccess/,
    );
    assert.match(
      persistenceSource,
      /export async function storeRecurringInvoiceCreationFailure/,
    );
    assert.doesNotMatch(invoiceSource, /claimScheduleForInvoice/);
    assert.doesNotMatch(invoiceSource, /async function claimScheduleForInvoice/);
    assert.doesNotMatch(workflowSource, /async function claimScheduleForInvoice/);
    assert.doesNotMatch(invoiceSource, /storeRecurringInvoiceCreationSuccess/);
    assert.doesNotMatch(
      invoiceSource,
      /async function storeRecurringInvoiceCreationSuccess/,
    );
    assert.doesNotMatch(workflowSource, /async function storeRecurringInvoiceCreationSuccess/);
    assert.doesNotMatch(invoiceSource, /storeRecurringInvoiceCreationFailure/);
    assert.doesNotMatch(
      invoiceSource,
      /async function storeRecurringInvoiceCreationFailure/,
    );
    assert.doesNotMatch(workflowSource, /async function storeRecurringInvoiceCreationFailure/);
  });
});
