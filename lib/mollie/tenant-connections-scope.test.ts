import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("tenant Mollie OAuth connection scope", () => {
  const source = readFileSync(resolve("lib/mollie/tenant-connections.ts"), "utf8");

  it("uses a dedicated encrypted OAuth token scope", () => {
    assert.match(source, /mollie-manager:tenant-mollie-oauth:/);
    assert.match(source, /currentSecret: process\.env\.APP_ENCRYPTION_KEY/);
    assert.doesNotMatch(source, /legacySecret: process\.env\.AUTH_SECRET/);
  });

  it("fences each connection by an explicit tenant and blocks API-key fallback", () => {
    assert.match(source, /Explicit tenant context is required\./);
    assert.match(source, /where tenant_id = \$\{requireTenantId\(tenantId\)\}/);
    assert.match(source, /if \(connection !== null\)[\s\S]*Tenant Mollie reconnect is required\./);
    assert.match(source, /const legacy = await getTenantMollieCredentials\(tenantId, mode\)/);
  });

  it("clears durable OAuth material for revoked and disconnected states", () => {
    assert.match(source, /excluded\.status in \('revoked', 'reconnect_required', 'disconnected'\) then null/);
  });
});
