import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("Kify invoice workflow guard", () => {
  it("fails closed instead of falling back to a legacy provider", () => {
    const resolver = readFileSync("lib/invoicing/provider-resolver.ts", "utf8");
    assert.match(resolver, /Kify invoice issuance must use the Kify workflow/);
  });

  it("checks Kify profile readiness before creating a real-installment link", () => {
    const workflow = readFileSync("lib/onboarding/first-payment-action-flow.ts", "utf8");
    const readinessIndex = workflow.indexOf("getKifyInvoiceReadiness");
    const sideEffectIndex = workflow.indexOf("createFirstPaymentOnboardingFlow");
    assert.ok(readinessIndex >= 0 && readinessIndex < sideEffectIndex);
    assert.match(workflow, /firstPaymentMode === "real_installment"/);
    assert.match(workflow, /getTenantActiveInvoiceProvider\(input\.tenantId\)\) === "kify"/);
  });

  it("routes first payments and due schedules to Kify before legacy adapter resolution", () => {
    const firstPayment = readFileSync("lib/eboekhouden/first-payment-invoices.ts", "utf8");
    const recurring = readFileSync("lib/eboekhouden/recurring-invoices.ts", "utf8");
    assert.ok(firstPayment.indexOf('provider === "kify"') < firstPayment.lastIndexOf("getInvoiceProviderAdapterById(provider)"));
    assert.ok(recurring.indexOf('provider === "kify"') < recurring.lastIndexOf("getInvoiceProviderAdapterById(provider)"));
    assert.match(firstPayment, /issueKifyInvoice/);
    assert.match(recurring, /issueKifyInvoice/);
  });

  it("does not resolve a legacy adapter for a Kify recurring-invoice batch", () => {
    const recurring = readFileSync("lib/eboekhouden/recurring-invoices.ts", "utf8");
    const batchStart = recurring.indexOf("export async function createDueRecurringInvoicesBatch");
    const batch = recurring.slice(batchStart);
    assert.ok(batch.indexOf('provider !== "kify"') < batch.indexOf("getInvoiceProviderAdapterById(provider)"));
  });
});
