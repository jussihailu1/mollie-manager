import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("reconciliation operations tenant scope", () => {
  it("requires tenant id through reconciliation fan-out and before/after snapshots", () => {
    const source = readFileSync("lib/reliability/reconciliation-operations.ts", "utf8");

    assert.match(source, /syncPaymentByMollieId: \(molliePaymentId: string, options: \{[\s\S]*tenantId: string;/);
    assert.match(source, /syncPaymentLinkByMollieId: \(molliePaymentLinkId: string, options: \{[\s\S]*tenantId: string;/);
    assert.match(source, /syncSubscriptionByLocalId: \(localSubscriptionId: string, options: \{[\s\S]*tenantId: string;/);
    assert.match(source, /throw new Error\("Explicit tenant context is required\."\);/);
    assert.match(source, /const tenantId = requireTenantId\(input\.tenantId\)/);
    assert.match(source, /getFirstPaymentInvoiceStateCounts\(modeParam, tenantId\)/);
    assert.match(source, /getRecurringInvoiceStateCounts\(modeParam, tenantId\)/);
    assert.match(source, /and tenant_id = \$\{tenantId\}/);
    assert.match(source, /await input\.syncSubscriptionByLocalId\(subscription\.id, \{[\s\S]*tenantId,/);
    assert.match(source, /await input\.syncPaymentLinkByMollieId\(paymentLink\.molliePaymentLinkId, \{[\s\S]*tenantId,/);
    assert.match(source, /await input\.syncPaymentByMollieId\(payment\.molliePaymentId, \{[\s\S]*tenantId,/);
    assert.doesNotMatch(source, /tenantId: input\.tenantId \?\? undefined/);
    assert.doesNotMatch(source, /tenantParam \?\? undefined/);
    assert.doesNotMatch(source, /\(\$\{tenantParam\}::text is null or tenant_id = \$\{tenantParam\}\)/);
  });
});
