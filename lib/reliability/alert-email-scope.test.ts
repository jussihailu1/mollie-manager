import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("alert email scope", () => {
  it("fences alert email lookup to tenant-owned linked entities when tenant id is provided", () => {
    const source = readFileSync("lib/reliability/alert-email.ts", "utf8");

    assert.match(source, /tenantId\?: string/);
    assert.match(source, /p\.tenant_id = \$\{tenantId \?\? null\}/);
    assert.match(source, /s\.tenant_id = \$\{tenantId \?\? null\}/);
    assert.match(source, /customer\.tenant_id = \$\{tenantId \?\? null\}/);
    assert.match(source, /fallback_customer\.tenant_id = \$\{tenantId \?\? null\}/);
    assert.match(source, /or customer\.id is not null/);
    assert.match(source, /or fallback_customer\.id is not null/);
    assert.match(source, /or p\.id is not null/);
    assert.match(source, /or s\.id is not null/);
  });
});
