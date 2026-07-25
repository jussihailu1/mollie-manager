import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

function readRepoFile(filePath: string) {
  return readFileSync(resolve(filePath), "utf8");
}

describe("multi-tenant pilot release gates", () => {
  it("keeps normal operator access and dashboard surfaces fenced to the active tenant", () => {
    const loginPageSource = readRepoFile("app/login/page.tsx");
    const tenantAccessSource = readRepoFile("lib/tenant-context.ts");
    const overviewSource = readRepoFile("app/(dashboard)/page.tsx");
    const customersSource = readRepoFile("app/(dashboard)/customers/customers-page.tsx");
    const paymentsSource = readRepoFile("app/(dashboard)/payments/payments-page.tsx");
    const notificationsSource = readRepoFile(
      "app/(dashboard)/notifications/page.tsx",
    );
    const settingsSource = readRepoFile("app/(dashboard)/settings/page.tsx");

    assert.match(loginPageSource, /getTenantAccessForOperatorEmail/);
    assert.match(
      loginPageSource,
      /does not have tenant or platform access yet\./,
    );
    assert.match(
      tenantAccessSource,
      /requireTenantAccessForOperatorEmail\(session\.user\.email\)/,
    );
    assert.match(
      tenantAccessSource,
      /redirect\("\/login\?error=AccessDenied"\)/,
    );

    for (const source of [
      overviewSource,
      customersSource,
      paymentsSource,
      notificationsSource,
      settingsSource,
    ]) {
      assert.match(source, /getCurrentTenantSelectionForViewer/);
      assert.match(source, /tenantId/);
    }

    assert.match(overviewSource, /tenantId = currentTenant\.id/);
    assert.match(customersSource, /tenantId = currentTenant\.id/);
    assert.match(paymentsSource, /tenantId = currentTenant\.id/);
    assert.match(notificationsSource, /tenantId = currentTenant\.id/);
    assert.match(settingsSource, /tenantId = tenantSelection\.currentTenant\.id/);
  });

  it("uses tenant-owned provider credentials on the verified business seams", () => {
    const mollieClientSource = readRepoFile("lib/mollie/client.ts");
    const eboekhoudenClientSource = readRepoFile("lib/eboekhouden/client.ts");
    const paymentRouteSource = readRepoFile("app/api/payments/mollie/route.ts");
    const activationSource = readRepoFile(
      "lib/onboarding/subscription-activation.ts",
    );

    assert.match(
      mollieClientSource,
      /const authentication = await resolveTenantMollieAuthentication\(tenantId, mode\);/,
    );
    assert.match(
      mollieClientSource,
      /authentication\.kind === "oauth"\s*\? createMollieClient\(\{ accessToken: authentication\.accessToken \}\)\s*:\s*createMollieClient\(\{ apiKey: authentication\.apiKey \}\);/,
    );
    assert.match(
      mollieClientSource,
      /\? `\$\{tenantId\}:oauth:\$\{authentication\.connectionId\}:\$\{authentication\.accessToken\}`/,
    );
    assert.match(
      eboekhoudenClientSource,
      /return await resolveTenantEboekhoudenConfig\(tenantId\);/,
    );
    assert.match(
      eboekhoudenClientSource,
      /export async function createEboekhoudenInvoice\(\s*payload: EboekhoudenCreateInvoiceInput,\s*tenantId: string,\s*\)/,
    );
    assert.match(
      eboekhoudenClientSource,
      /export async function updateEboekhoudenRelation\(\s*id: number,\s*payload: Record<string, unknown>,\s*tenantId: string,\s*\)/,
    );
    assert.match(
      paymentRouteSource,
      /const mollie = await getTenantMollieClient\(tenantId, selectedMode\);/,
    );
    assert.match(
      activationSource,
      /export async function attemptSubscriptionActivation\(input: \{[\s\S]*tenantId: string;[\s\S]*trigger: ActivationTrigger;/,
    );
  });

  it("requires resolved tenant context before webhook and cron follow-up act", () => {
    const webhookRouteSource = readRepoFile("app/api/webhooks/mollie/route.ts");
    const webhookProcessingSource = readRepoFile(
      "lib/reliability/webhook-processing.ts",
    );
    const cronRouteSource = readRepoFile("app/api/cron/recurring-invoices/route.ts");

    assert.match(webhookRouteSource, /tenant_id as "tenantId"/);
    assert.match(
      webhookRouteSource,
      /requireManagedResource: true/,
    );
    assert.match(
      webhookProcessingSource,
      /tenantId: existingResourceContext\?\.tenantId \?\? null/,
    );
    assert.match(
      webhookProcessingSource,
      /if \(!existingResourceContext\?\.tenantId\)/,
    );
    assert.match(
      webhookProcessingSource,
      /Webhook is not linked to a managed local resource\./,
    );

    assert.match(cronRouteSource, /const tenants = await listTenants\(\)/);
    assert.match(cronRouteSource, /tenantId: input\.tenantId/);
    assert.match(
      cronRouteSource,
      /repairWebhookEventsBatch\([\s\S]*tenantId: input\.tenantId/,
    );
    assert.match(
      cronRouteSource,
      /repairStaleRecordsBatch\([\s\S]*tenantId: input\.tenantId/,
    );
    assert.match(
      cronRouteSource,
      /entityType: "tenant_recurring_billing_cron"/,
    );
  });

  it("preserves money-flow safeguards after tenant scoping on key billing seams", () => {
    const failedPaymentSource = readRepoFile(
      "lib/failed-payment-customer-notifications.ts",
    );
    const syncSource = readRepoFile("lib/reliability/sync.ts");
    const reconciliationSource = readRepoFile(
      "lib/reliability/reconciliation-operations.ts",
    );

    assert.match(failedPaymentSource, /p\.tenant_id as "tenantId"/);
    assert.match(
      failedPaymentSource,
      /left join customers c on c\.id = p\.customer_id and c\.tenant_id = p\.tenant_id/,
    );
    assert.match(
      failedPaymentSource,
      /left join recurring_billing_schedules rbs on rbs\.payment_id = p\.id and rbs\.tenant_id = p\.tenant_id/,
    );
    assert.match(syncSource, /Payment tenant context is missing\./);
    assert.match(syncSource, /Payment-link tenant context is missing\./);
    assert.match(
      syncSource,
      /attemptSubscriptionActivation\(\{[\s\S]*tenantId: resolvedTenantId,[\s\S]*trigger: "auto"/,
    );
    assert.match(
      reconciliationSource,
      /throw new Error\("Explicit tenant context is required\."\);/,
    );
    assert.match(
      reconciliationSource,
      /getFirstPaymentInvoiceStateCounts\(modeParam, tenantId\)/,
    );
    assert.match(
      reconciliationSource,
      /getRecurringInvoiceStateCounts\(modeParam, tenantId\)/,
    );
    assert.doesNotMatch(
      reconciliationSource,
      /\(\$\{tenantParam\}::text is null or tenant_id = \$\{tenantParam\}\)/,
    );
  });
});
