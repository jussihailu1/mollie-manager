import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const syncSource = readFileSync("lib/reliability/sync.ts", "utf8");
const lookupSource = readFileSync("lib/reliability/sync-mollie-lookups.ts", "utf8");

describe("sync mollie lookup module boundary", () => {
  it("keeps lookup wrappers out of the main sync file and threads tenant-aware client resolution", () => {
    assert.match(syncSource, /@\/lib\/reliability\/sync-mollie-lookups/);
    assert.match(lookupSource, /export async function findPaymentAcrossModes/);
    assert.match(lookupSource, /export async function findPaymentLinkAcrossModes/);
    assert.match(lookupSource, /export async function findSubscriptionAcrossModes/);
    assert.match(lookupSource, /async function buildLookupMollieModeOrder\(input: \{/);
    assert.match(lookupSource, /tenantId\?: string;/);
    assert.match(lookupSource, /if \(!tenantId\) \{/);
    assert.match(lookupSource, /buildConfiguredMollieModeOrder\(\{/);
    assert.match(lookupSource, /await getTenantMollieRequestAuthentication\(tenantId, mode\);/);
    assert.match(
      lookupSource,
      /getTenantMollieRequestContext\(tenantId, mode\)[\s\S]*client\.payments\.get\(molliePaymentId, \{ \.\.\.\(testmode \? \{ testmode \} : \{\}\) \}\)/,
    );
    assert.match(
      lookupSource,
      /getTenantMollieRequestContext\(tenantId, mode\)[\s\S]*client\.paymentLinks\.get\(/,
    );
    assert.match(
      lookupSource,
      /const client = await getTenantMollieClient\(tenantId, mode\);/,
    );
    assert.match(lookupSource, /findPaymentAcrossModes\([\s\S]*tenantId\?: string/);
    assert.match(lookupSource, /findPaymentLinkAcrossModes\([\s\S]*tenantId\?: string/);
    assert.match(lookupSource, /findSubscriptionAcrossModes\([\s\S]*tenantId\?: string/);
    assert.doesNotMatch(syncSource, /async function findPaymentAcrossModes/);
    assert.doesNotMatch(syncSource, /async function findPaymentLinkAcrossModes/);
    assert.doesNotMatch(syncSource, /async function findSubscriptionAcrossModes/);
  });
});
