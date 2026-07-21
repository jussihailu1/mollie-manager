import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("tenant readiness scope", () => {
  it("checks tenant-owned live credentials and active provider setup completeness", () => {
    const source = readFileSync(resolve("lib/tenant-readiness.ts"), "utf8");

    assert.match(source, /getTenantMollieCredentials\(tenantId, "live"\)/);
    assert.match(source, /getTenantEboekhoudenCredentials\(tenantId\)/);
    assert.match(source, /getTenantBillingSettings\(tenantId\)/);
    assert.match(source, /getInvoiceProviderAdapterById\(activeInvoiceProvider\)\.validateTenantSetup/);
    assert.match(source, /activeInvoiceProvider === "kify"/);
    assert.match(source, /getKifyTenantInvoiceReadiness\(tenantId\)/);
    assert.match(source, /billingSettingsAreComplete\(billingSettings\)/);
    assert.match(source, /getTenantSubscriptionPolicyDefaults\(tenantId\)/);
    assert.match(source, /name: "tenant_live_mode_only"/);
    assert.match(source, /name: "tenant_active_invoice_provider_ready"/);
    assert.doesNotMatch(source, /EBOEKHOUDEN_API_TOKEN/);
    assert.doesNotMatch(source, /MOLLIE_DEFAULT_MODE/);
  });

  it("keeps a separate platform readiness view and a tenant readiness command", () => {
    const helperSource = readFileSync(resolve("lib/tenant-readiness.ts"), "utf8");
    const scriptSource = readFileSync(resolve("scripts/tenant-readiness.ts"), "utf8");
    const packageSource = readFileSync(resolve("package.json"), "utf8");

    assert.match(helperSource, /export function getPlatformReadiness\(\)/);
    assert.match(helperSource, /export async function getTenantReadiness\(tenantId: string\)/);
    assert.match(scriptSource, /import { loadEnvConfig } from "@next\/env";/);
    assert.match(scriptSource, /loadEnvConfig\(process\.cwd\(\)\);/);
    assert.match(scriptSource, /await import\(\s*"@\/lib\/tenant-readiness"\s*\)/);
    assert.match(scriptSource, /Missing required --tenant-id argument\./);
    assert.match(scriptSource, /getTenantReadiness\(tenantId\)/);
    assert.match(
      packageSource,
      /"tenant:readiness": "node --conditions=react-server --import tsx scripts\/tenant-readiness\.ts"/,
    );
  });
});
