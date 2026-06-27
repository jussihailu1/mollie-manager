import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const routeSource = readFileSync(
  "app/api/cron/recurring-invoices/route.ts",
  "utf8",
);

describe("recurring invoice cron tenant scope", () => {
  it("fans cron work through explicit tenant ids", () => {
    assert.match(routeSource, /import { listTenants } from "@\/lib\/tenants";/);
    assert.match(routeSource, /const tenants = await listTenants\(\)/);
    assert.match(routeSource, /tenantId: input\.tenantId/);
    assert.match(routeSource, /entityId: input\.tenantId/);
    assert.match(routeSource, /entityType: "tenant_recurring_billing_cron"/);
    assert.match(routeSource, /repairWebhookEventsBatch\([\s\S]*tenantId: input\.tenantId/);
    assert.match(routeSource, /repairStaleRecordsBatch\([\s\S]*tenantId: input\.tenantId/);
    assert.match(routeSource, /queueRetryForSafeFailedRecurringInvoicesBatch\([\s\S]*tenantId: input\.tenantId/);
    assert.match(routeSource, /queueRetryForSafeFailedFirstPaymentInvoicesBatch\([\s\S]*tenantId: input\.tenantId/);
    assert.match(routeSource, /recoverFailedRecurringInvoicesBatch\([\s\S]*tenantId: input\.tenantId/);
    assert.match(routeSource, /recoverFailedFirstPaymentInvoicesBatch\([\s\S]*tenantId: input\.tenantId/);
    assert.match(routeSource, /retryUnsentRecurringInvoiceEmailsBatch\([\s\S]*tenantId: input\.tenantId/);
    assert.match(routeSource, /retryUnsentFirstPaymentInvoiceEmailsBatch\([\s\S]*tenantId: input\.tenantId/);
  });
});
