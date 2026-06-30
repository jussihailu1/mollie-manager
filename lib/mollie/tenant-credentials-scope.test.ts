import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("tenant Mollie credential scope", () => {
  it("stores encrypted tenant keys and keeps the legacy default fallback explicit", () => {
    const source = readFileSync(resolve("lib/mollie/tenant-credentials.ts"), "utf8");

    assert.match(source, /export class TenantMollieCredentialError extends Error/);
    assert.match(source, /createCipheriv\(/);
    assert.match(source, /createDecipheriv\(/);
    assert.match(source, /encryptTenantMollieApiKey/);
    assert.match(source, /decryptTenantMollieApiKey/);
    assert.match(source, /insert into tenant_mollie_credentials/);
    assert.match(source, /select[\s\S]*from tenant_mollie_credentials/);
    assert.match(source, /if \(tenantId === LEGACY_DEFAULT_TENANT_ID\)/);
    assert.match(source, /Tenant Mollie credentials are missing\./);
    assert.match(source, /mollie-manager:tenant-mollie-credentials:/);
  });
});
