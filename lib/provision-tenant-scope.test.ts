import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("tenant provisioning boundary", () => {
  it("keeps tenant setup explicit and threads both credential bootstrap paths through the script", () => {
    const tenantsSource = readFileSync(resolve("lib/tenants.ts"), "utf8");
    const scriptSource = readFileSync(resolve("scripts/provision-tenant.ts"), "utf8");
    const provisionTenantSource =
      tenantsSource.match(
        /export async function provisionTenant\(input: ProvisionTenantInput\)[\s\S]*?return tenantId;\r?\n\}/,
      )?.[0] ?? tenantsSource;

    assert.match(tenantsSource, /export async function provisionTenant\(input: ProvisionTenantInput\)/);
    assert.match(tenantsSource, /const tenantId = input\.tenantId\?\.trim\(\) \|\| crypto\.randomUUID\(\);/);
    assert.match(tenantsSource, /insert into tenants/);
    assert.match(tenantsSource, /insert into operator_tenant_memberships/);
    assert.match(tenantsSource, /insert into platform_operators/);
    assert.doesNotMatch(provisionTenantSource, /getSingleTenantIdOrThrow/);
    assert.doesNotMatch(provisionTenantSource, /getTenantMollieClient/);

    assert.match(scriptSource, /import { getDefaultMollieMode } from "@\/lib\/mollie\/client";/);
    assert.match(scriptSource, /import { upsertTenantMollieCredentials } from "@\/lib\/mollie\/tenant-credentials";/);
    assert.match(scriptSource, /mollieApiKey: string \| null;/);
    assert.match(scriptSource, /mollieMode: "test" \| "live" \| null;/);
    assert.match(scriptSource, /await ensureTenantSubscriptionPolicyDefaults\(tenantId\);/);
    assert.match(scriptSource, /await ensureTenantBillingSettings\(tenantId\);/);
    assert.match(scriptSource, /await upsertTenantEboekhoudenCredentials\(/);
    assert.match(scriptSource, /await upsertTenantMollieCredentials\(/);
    assert.match(scriptSource, /hasMollieCredentials: Boolean\(args\.mollieApiKey\)/);
    assert.match(
      scriptSource,
      /mollieMode: args\.mollieApiKey[\s\S]*?args\.mollieMode \?\? getDefaultMollieMode\(\)[\s\S]*?: null,/,
    );
    assert.match(scriptSource, /await ensureTenantSubscriptionPolicyDefaults\(tenantId\);/);
    assert.match(scriptSource, /await ensureTenantBillingSettings\(tenantId\);/);
    assert.match(scriptSource, /hasEboekhoudenCredentials: Boolean\(args\.eboekhoudenApiToken\)/);
  });
});
