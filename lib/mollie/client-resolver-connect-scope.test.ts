import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

function readSource(path: string) {
  return readFileSync(resolve(path), "utf8");
}

function productionTypeScriptFiles(directory: string): string[] {
  return readdirSync(resolve(directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return productionTypeScriptFiles(path);
    return entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

describe("Mollie Connect credential-neutral tenant client resolver", () => {
  const clientSource = readSource("lib/mollie/client.ts");
  const invoiceProviderSource = readSource("lib/invoicing/providers/mollie.ts");

  it("constructs tenant clients from either OAuth access tokens or the temporary API-key path", () => {
    assert.match(clientSource, /const authentication = await resolveTenantMollieAuthentication\(tenantId, mode\)/);
    assert.match(clientSource, /authentication\.kind === "oauth"[\s\S]*createMollieClient\(\{ accessToken: authentication\.accessToken \}\)/);
    assert.match(clientSource, /createMollieClient\(\{ apiKey: authentication\.apiKey \}\)/);
    assert.match(clientSource, /export async function getTenantMollieRequestAuthentication\([\s\S]*return resolveTenantMollieAuthentication\(tenantId, mode\)/);
    assert.match(clientSource, /export async function getTenantMollieRequestContext\([\s\S]*profileId: authentication\.profileId,[\s\S]*mode === "test" \? \{ testmode: true as const \} : \{\}/);
  });

  it("isolates cached OAuth clients by tenant, connection, and refreshed access-token version", () => {
    assert.match(
      clientSource,
      /\? `\$\{tenantId\}:oauth:\$\{authentication\.connectionId\}:\$\{authentication\.accessToken\}`/,
    );
    assert.match(clientSource, /: `\$\{tenantId\}:api_key:\$\{mode\}`/);
    assert.match(clientSource, /const tenantClientCache = new Map<string, MollieClient>\(\)/);
  });

  it("uses the same credential-neutral resolver for Mollie Sales Invoice requests", () => {
    assert.match(invoiceProviderSource, /import \{ getTenantMollieRequestAuthentication \} from "@\/lib\/mollie\/client"/);
    assert.match(invoiceProviderSource, /const authentication = await getTenantMollieRequestAuthentication\(input\.tenantId, input\.mode\)/);
    assert.match(invoiceProviderSource, /Authorization: `Bearer \$\{authentication\.kind === "oauth" \? authentication\.accessToken : authentication\.apiKey\}`/);
    assert.match(invoiceProviderSource, /url\.searchParams\.set\("testmode", "true"\)/);
    assert.match(invoiceProviderSource, /profileId: authentication\.profileId/);
    assert.match(invoiceProviderSource, /testmode: true/);
    assert.doesNotMatch(invoiceProviderSource, /getMollieApiKey\(|resolveTenantMollieConfig\(/);
  });

  it("keeps resolveTenantMollieConfig out of production callers", () => {
    const callers = [...productionTypeScriptFiles("app"), ...productionTypeScriptFiles("lib")]
      .filter((path) => path !== "lib/mollie/tenant-credentials.ts")
      .filter((path) => /(?:import\s*\{[^}]*\bresolveTenantMollieConfig\b|\bresolveTenantMollieConfig\s*\()/.test(readSource(path)));

    assert.deepEqual(callers, []);
  });
});
