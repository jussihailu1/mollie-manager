import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const firstPaymentSource = readFileSync(
  "lib/eboekhouden/first-payment-invoices.ts",
  "utf8",
);
const workflowSource = readFileSync(
  "lib/eboekhouden/first-payment-invoice-workflow.ts",
  "utf8",
);

describe("first-payment invoice workflow module boundary", () => {
  it("moves invoice creation orchestration out of the main invoice file", () => {
    assert.match(firstPaymentSource, /@\/lib\/eboekhouden\/first-payment-invoice-workflow/);
    assert.match(workflowSource, /export async function createEboekhoudenInvoiceForFirstPayment/);
    assert.match(workflowSource, /subscriptionConsentPlanSnapshotSchema/);
    assert.doesNotMatch(firstPaymentSource, /export async function createEboekhoudenInvoiceForFirstPayment/);
    assert.doesNotMatch(firstPaymentSource, /subscriptionConsentPlanSnapshotSchema/);
  });
});
