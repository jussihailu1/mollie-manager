import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync("lib/eboekhouden/tenant-credentials.ts", "utf8");

describe("tenant e-Boekhouden credential scope", () => {
  it("fails closed without explicit tenant context while preserving explicit legacy-default bootstrap reads", () => {
    assert.match(source, /function requireTenantId\(tenantId\?: string\)/);
    assert.match(
      source,
      /throw new TenantEboekhoudenCredentialError\(\s*"Explicit tenant context is required\."/,
    );
    assert.match(source, /const resolvedTenantId = requireTenantId\(tenantId\);/);
    assert.match(source, /const stored = await getTenantEboekhoudenCredentials\(resolvedTenantId\);/);
    assert.match(source, /if \(resolvedTenantId === LEGACY_DEFAULT_TENANT_ID\)/);
    assert.doesNotMatch(source, /if \(!tenantId\) \{\s*return getEboekhoudenConfig\(\);/);
  });
});
