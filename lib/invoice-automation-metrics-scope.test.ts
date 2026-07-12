import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("invoice automation metrics tenant scope", () => {
  it("tracks cron heartbeat through the tenant cron audit entity", () => {
    const source = readFileSync(resolve("lib/invoice-automation-metrics.ts"), "utf8");

    assert.match(source, /getInvoiceAutomationSnapshot\([\s\S]*mode: MollieMode,[\s\S]*tenantId\?: string/);
    assert.match(source, /getInvoiceAutomationCronHeartbeat\([\s\S]*mode: MollieMode,[\s\S]*tenantId\?: string/);
    assert.match(source, /tenant_recurring_billing_cron/);
    assert.match(source, /al2\.entity_id = \$\{resolvedTenantId\}/);
    assert.match(source, /al\.entity_id = \$\{resolvedTenantId\}/);
    assert.match(source, /lastCronRunAt/);
    assert.match(source, /lastCronRunOutcome/);
    assert.match(source, /lastCronFailureAt/);
    assert.match(source, /lastCronSuccessAt/);
    assert.match(source, /Explicit tenant context is required\./);
    assert.doesNotMatch(source, /al2\.entity_type = 'payment'/);
    assert.doesNotMatch(source, /al\.entity_type = 'payment'/);
    assert.doesNotMatch(source, /getSingleTenantIdOrThrow/);
  });
});
