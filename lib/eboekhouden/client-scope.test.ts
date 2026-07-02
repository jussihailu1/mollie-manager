import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const clientSource = readFileSync("lib/eboekhouden/client.ts", "utf8");
const credentialSource = readFileSync(
  "lib/eboekhouden/tenant-credentials.ts",
  "utf8",
);

describe("e-Boekhouden client tenant credential scope", () => {
  it("threads tenant context through relation and invoice read/mutation ops", () => {
    assert.match(
      clientSource,
      /resolveTenantEboekhoudenConfig,/,
    );
    assert.match(clientSource, /const sessionCacheByKey = new Map<string, SessionCache>\(\);/);
    assert.match(clientSource, /async function getConfig\(tenantId\?: string\)/);
    assert.match(clientSource, /Explicit tenant context is required\./);
    assert.match(clientSource, /return await resolveTenantEboekhoudenConfig\(tenantId\);/);
    assert.match(clientSource, /error instanceof TenantEboekhoudenCredentialError/);
    assert.match(clientSource, /tenantId: string;/);
    assert.match(
      clientSource,
      /export async function getEboekhoudenRelation\(id: number, tenantId: string\)/,
    );
    assert.match(
      clientSource,
      /export async function createEboekhoudenInvoice\(\s*payload: EboekhoudenCreateInvoiceInput,\s*tenantId: string,\s*\)/,
    );
    assert.match(
      clientSource,
      /export async function getEboekhoudenInvoice\(id: number, tenantId: string\)/,
    );
    assert.match(
      clientSource,
      /export async function listEboekhoudenInvoices\(\s*options: \{[\s\S]*tenantId: string;[\s\S]*\}\)/,
    );
    assert.match(
      clientSource,
      /export async function createEboekhoudenRelation\(\s*payload: Record<string, unknown>,\s*tenantId: string,\s*\)/,
    );
    assert.match(
      clientSource,
      /export async function updateEboekhoudenRelation\(\s*id: number,\s*payload: Record<string, unknown>,\s*tenantId: string,\s*\)/,
    );
    assert.match(clientSource, /listEboekhoudenInvoiceTemplates\(options: \{[\s\S]*tenantId: string;/);
    assert.match(clientSource, /listEboekhoudenLedgers\(options: \{[\s\S]*tenantId: string;/);
    assert.match(
      clientSource,
      /export async function createEboekhoudenInvoice\([\s\S]*requestEboekhouden<EboekhoudenInvoice>[\s\S]*tenantId\);/,
    );
    assert.match(
      clientSource,
      /export async function createEboekhoudenRelation\([\s\S]*requestEboekhouden<\{ id\?: number \} \| EboekhoudenRelation>[\s\S]*tenantId\);/,
    );
    assert.match(
      clientSource,
      /export async function updateEboekhoudenRelation\([\s\S]*requestEboekhouden<void>[\s\S]*tenantId\);/,
    );
  });

  it("stores encrypted tenant e-Boekhouden tokens and only keeps explicit legacy-default env fallback", () => {
    assert.match(credentialSource, /export class TenantEboekhoudenCredentialError extends Error/);
    assert.match(credentialSource, /decryptTenantCredential,/);
    assert.match(credentialSource, /encryptTenantCredential,/);
    assert.match(credentialSource, /encryptTenantEboekhoudenApiToken/);
    assert.match(credentialSource, /decryptTenantEboekhoudenApiToken/);
    assert.match(credentialSource, /APP_ENCRYPTION_KEY is missing\./);
    assert.match(
      credentialSource,
      /Stored tenant e-Boekhouden credentials still require AUTH_SECRET for legacy decryption\./,
    );
    assert.match(credentialSource, /insert into tenant_eboekhouden_credentials/);
    assert.match(credentialSource, /function requireTenantId\(tenantId\?: string\)/);
    assert.match(credentialSource, /throw new TenantEboekhoudenCredentialError\(\s*"Explicit tenant context is required\."/);
    assert.match(credentialSource, /if \(resolvedTenantId === LEGACY_DEFAULT_TENANT_ID\)/);
    assert.match(credentialSource, /Tenant e-Boekhouden credentials are missing\./);
    assert.doesNotMatch(credentialSource, /if \(!tenantId\) \{\s*return getEboekhoudenConfig\(\);/);
  });
});
