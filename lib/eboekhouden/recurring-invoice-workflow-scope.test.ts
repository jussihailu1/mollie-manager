import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const recurringSource = readFileSync("lib/eboekhouden/recurring-invoices.ts", "utf8");
const workflowSource = readFileSync(
  "lib/eboekhouden/recurring-invoice-workflow.ts",
  "utf8",
);

describe("recurring invoice workflow module boundary", () => {
  it("moves invoice creation orchestration out of main recurring invoice file", () => {
    assert.match(recurringSource, /@\/lib\/eboekhouden\/recurring-invoice-workflow/);
    assert.match(workflowSource, /export async function createEboekhoudenInvoiceForSchedule/);
    assert.match(workflowSource, /deliverCustomerInvoiceEmail/);
    assert.doesNotMatch(recurringSource, /export async function createEboekhoudenInvoiceForSchedule/);
    assert.doesNotMatch(recurringSource, /createEboekhoudenInvoice\(/);
  });
});
