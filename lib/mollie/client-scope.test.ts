import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("Mollie client boundary", () => {
  it("keeps the shared client cache separate from tenant-scoped business clients", () => {
    const clientSource = readFileSync(resolve("lib/mollie/client.ts"), "utf8");
    const credentialSource = readFileSync(
      resolve("lib/mollie/tenant-credentials.ts"),
      "utf8",
    );

    assert.match(clientSource, /const clientCache = new Map<MollieMode, MollieClient>\(\);/);
    assert.match(clientSource, /export function getDefaultMollieMode\(\): MollieMode/);
    assert.match(clientSource, /return env\.MOLLIE_DEFAULT_MODE;/);
    assert.match(clientSource, /export function isMollieConfigured\(mode: MollieMode\)/);
    assert.match(clientSource, /getMollieApiKey\(mode\);/);
    assert.match(clientSource, /resolveTenantMollieConfig,/);
    assert.match(
      clientSource,
      /export function getMollieClient\(mode: MollieMode = getDefaultMollieMode\(\)\)/,
    );
    assert.match(
      clientSource,
      /createMollieClient\(\{\s*apiKey: getMollieApiKey\(mode\),\s*\}\);/,
    );
    assert.match(clientSource, /export async function getTenantMollieClient\(/);
    assert.match(
      clientSource,
      /const tenantClientCache = new Map<string, MollieClient>\(\);/,
    );
    assert.match(clientSource, /const config = await resolveTenantMollieConfig\(tenantId, mode\);/);
    assert.match(clientSource, /const cacheKey = `\$\{tenantId\}:\$\{mode\}`;/);
    assert.match(clientSource, /tenantClientCache\.set\(cacheKey, client\);/);
    assert.match(
      clientSource,
      /createMollieClient\(\{\s*apiKey: config\.MOLLIE_API_KEY,\s*\}\);/,
    );
    assert.match(clientSource, /clientCache\.set\(mode, client\);/);
    assert.match(
      clientSource,
      /export function getMollieWebhookUrl\(path = "\/api\/webhooks\/mollie"\)/,
    );
    assert.match(credentialSource, /export class TenantMollieCredentialError extends Error/);
    assert.match(credentialSource, /encryptTenantMollieApiKey/);
    assert.match(credentialSource, /decryptTenantMollieApiKey/);
    assert.match(credentialSource, /insert into tenant_mollie_credentials/);
    assert.match(credentialSource, /Explicit tenant context is required\./);
    assert.match(credentialSource, /Tenant Mollie credentials are missing\./);
    assert.doesNotMatch(credentialSource, /LEGACY_DEFAULT_TENANT_ID/);
  });
});
