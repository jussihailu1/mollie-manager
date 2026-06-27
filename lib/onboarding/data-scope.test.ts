import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const source = readFileSync(resolve("lib/onboarding/data.ts"), "utf8");

describe("onboarding data tenant scope", () => {
  it("accepts explicit tenant ids on dashboard reads", () => {
    assert.match(source, /tenantId\?: string/);
    assert.match(source, /getLatestConsentLinkUrl\(\s*customerId: string,\s*mode: DashboardModeFilter = "all",\s*tenantId\?: string/);
    assert.match(source, /listCustomers\(options\?: \{[\s\S]*archived\?: boolean;[\s\S]*mode\?: DashboardModeFilter;[\s\S]*tenantId\?: string;/);
    assert.match(source, /listSubscriptions\(options\?: \{[\s\S]*tenantId\?: string;[\s\S]*mode\?: DashboardModeFilter;/);
    assert.match(source, /listPayments\(options\?: \{[\s\S]*tenantId\?: string;[\s\S]*mode\?: DashboardModeFilter;/);
  });

  it("filters customer, subscription, and payment reads by the resolved tenant", () => {
    assert.match(source, /resolvedTenantId = await resolveTenantId\(tenantId\)/);
    assert.match(source, /c\.tenant_id = \$\{resolvedTenantId\}/);
    assert.match(source, /p\.tenant_id = \$\{resolvedTenantId\}/);
    assert.match(source, /pl\.tenant_id = \$\{resolvedTenantId\}/);
    assert.match(source, /s\.tenant_id = \$\{resolvedTenantId\}/);
    assert.match(source, /soc\.tenant_id = \$\{resolvedTenantId\}/);
  });
});
