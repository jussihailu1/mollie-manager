import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("alert email scope", () => {
  it("requires tenant context for alert email lookup and fences linked entities", () => {
    const source = readFileSync("lib/reliability/alert-email.ts", "utf8");

    assert.match(source, /tenantId: string/);
    assert.match(source, /p\.tenant_id = \$\{tenantId\}/);
    assert.match(source, /s\.tenant_id = \$\{tenantId\}/);
    assert.match(source, /customer\.tenant_id = \$\{tenantId\}/);
    assert.match(source, /fallback_customer\.tenant_id = \$\{tenantId\}/);
    assert.doesNotMatch(source, /tenantId\?: string/);
    assert.doesNotMatch(source, /getSingleTenantIdOrThrow/);
  });
});
