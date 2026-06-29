import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("customer consent link route scope", () => {
  it("threads active tenant into consent link lookup", () => {
    const source = readFileSync("app/api/customer-consent-link/route.ts", "utf8");

    assert.match(source, /getCurrentTenantSelectionForViewer/);
    assert.match(source, /const \{ currentTenant \} = await getCurrentTenantSelectionForViewer\(\)/);
    assert.match(source, /getLatestConsentLinkUrl\(\s*customerId,\s*mode,\s*currentTenant\.id,\s*\)/);
    assert.doesNotMatch(source, /requireViewerSession/);
  });
});
