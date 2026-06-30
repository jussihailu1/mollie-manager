import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("customer overview consent scope", () => {
  it("keeps the broad onboarding overview token-free", () => {
    const source = readFileSync(resolve("lib/onboarding/data.ts"), "utf8");

    assert.doesNotMatch(source, /latestConsentToken/);
    assert.match(source, /getLatestConsentLinkUrl/);
  });

  it("keeps ui mapping token-free", () => {
    const source = readFileSync(resolve("lib/ui-data.ts"), "utf8");

    assert.doesNotMatch(source, /latestConsentToken/);
    assert.doesNotMatch(source, /buildConsentLinkUrl/);
  });

  it("scopes root customer and payment loaders by tenant", () => {
    const source = readFileSync(resolve("lib/onboarding/data.ts"), "utf8");

    assert.doesNotMatch(source, /getSingleTenantIdOrThrow/);
    assert.match(source, /c\.tenant_id = \$\{resolvedTenantId\}/);
    assert.match(source, /p\.tenant_id = \$\{resolvedTenantId\}/);
    assert.match(source, /pl\.tenant_id = \$\{resolvedTenantId\}/);
    assert.match(source, /m\.tenant_id = \$\{resolvedTenantId\}/);
    assert.match(source, /s\.tenant_id = \$\{resolvedTenantId\}/);
    assert.match(source, /soc\.tenant_id = \$\{resolvedTenantId\}/);
    assert.match(source, /where id = \$\{latestConsent\.consentId\}\s+and tenant_id = \$\{resolvedTenantId\}/);
  });
});
