import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("invoice delivery scope", () => {
  it("threads tenant ids through delivery candidates and alert emails", () => {
    const source = readFileSync("lib/invoice-delivery.ts", "utf8");

    assert.match(source, /tenantId\?: string/);
    assert.match(source, /p\.tenant_id as "tenantId"/);
    assert.match(source, /rbs\.tenant_id as "tenantId"/);
    assert.match(source, /tenantId: row\.tenantId/);
    assert.match(source, /tenantId: input\.tenantId/);
  });
});
