import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const clientSource = readFileSync("lib/eboekhouden/client.ts", "utf8");
const credentialSource = readFileSync(
  "lib/eboekhouden/tenant-credentials.ts",
  "utf8",
);

describe("e-Boekhouden client tenant credential scope", () => {
  it("resolves tenant-owned credentials for relation and discovery reads", () => {
    assert.match(
      clientSource,
      /resolveTenantEboekhoudenConfig,/,
    );
    assert.match(clientSource, /const sessionCacheByKey = new Map<string, SessionCache>\(\);/);
    assert.match(clientSource, /async function getConfig\(tenantId\?: string\)/);
    assert.match(clientSource, /return await resolveTenantEboekhoudenConfig\(tenantId\);/);
    assert.match(clientSource, /error instanceof TenantEboekhoudenCredentialError/);
    assert.match(clientSource, /tenantId\?: string;/);
    assert.match(
      clientSource,
      /export async function getEboekhoudenRelation\(id: number, tenantId\?: string\)/,
    );
    assert.match(clientSource, /listEboekhoudenInvoiceTemplates\(options\?: \{[\s\S]*tenantId\?: string;/);
    assert.match(clientSource, /listEboekhoudenLedgers\(options\?: \{[\s\S]*tenantId\?: string;/);
  });

  it("stores encrypted tenant e-Boekhouden tokens and keeps legacy-default env fallback", () => {
    assert.match(credentialSource, /export class TenantEboekhoudenCredentialError extends Error/);
    assert.match(credentialSource, /encryptTenantEboekhoudenApiToken/);
    assert.match(credentialSource, /decryptTenantEboekhoudenApiToken/);
    assert.match(credentialSource, /insert into tenant_eboekhouden_credentials/);
    assert.match(credentialSource, /if \(tenantId === LEGACY_DEFAULT_TENANT_ID\)/);
    assert.match(credentialSource, /Tenant e-Boekhouden credentials are missing\./);
  });
});
