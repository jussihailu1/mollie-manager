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
    assert.match(
      workflowSource,
      /getFirstPaymentInvoiceCandidate\(paymentId, options\.tenantId\)/,
    );
    assert.match(
      workflowSource,
      /claimFirstPaymentInvoiceForCreation\(\{[\s\S]*tenantId: options\.tenantId,[\s\S]*\}\)/,
    );
    assert.match(workflowSource, /tenantId: candidate\.tenantId/);
    assert.match(
      workflowSource,
      /findExistingEboekhoudenInvoiceByReference\(\{[\s\S]*tenantId: candidate\.tenantId,/,
    );
    assert.match(
      workflowSource,
      /createEboekhoudenInvoice\(\s*invoiceInput,\s*candidate\.tenantId,\s*\)/,
    );
    assert.doesNotMatch(firstPaymentSource, /export async function createEboekhoudenInvoiceForFirstPayment/);
    assert.match(firstPaymentSource, /createInvoiceForFirstPayment/);
    assert.match(firstPaymentSource, /activeInvoiceProvider/);
  });
});
