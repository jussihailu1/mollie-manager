import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("reconciliation operations tenant scope", () => {
  it("threads tenant id through reconciliation fan-out and before/after snapshots", () => {
    const source = readFileSync("lib/reliability/reconciliation-operations.ts", "utf8");

    assert.match(source, /syncPaymentByMollieId: \(molliePaymentId: string, options: \{[\s\S]*tenantId\?: string;/);
    assert.match(source, /syncPaymentLinkByMollieId: \(molliePaymentLinkId: string, options: \{[\s\S]*tenantId\?: string;/);
    assert.match(source, /tenantId: input\.tenantId \?\? undefined,/);
    assert.match(source, /getFirstPaymentInvoiceStateCounts\(modeParam, tenantParam \?\? undefined\)/);
    assert.match(source, /getRecurringInvoiceStateCounts\(modeParam, tenantParam \?\? undefined\)/);
    assert.match(source, /await input\.syncPaymentLinkByMollieId\(paymentLink\.molliePaymentLinkId, \{[\s\S]*tenantId: input\.tenantId \?\? undefined,/);
    assert.match(source, /await input\.syncPaymentByMollieId\(payment\.molliePaymentId, \{[\s\S]*tenantId: input\.tenantId \?\? undefined,/);
  });
});
