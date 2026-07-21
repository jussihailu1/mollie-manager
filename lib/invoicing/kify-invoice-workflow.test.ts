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
    assert.match(workflow, /getTenantActiveInvoiceProvider\(input\.tenantId\) === "kify"/);
  });
});
