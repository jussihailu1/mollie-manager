import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("payment drawer tenant scope", () => {
  it("scopes the payment drawer lookup to the active tenant", () => {
    const source = readFileSync(
      resolve("app/api/payments/mollie/route.ts"),
      "utf8",
    );

    assert.match(source, /getCurrentTenantSelectionForViewer/);
    assert.match(source, /currentTenant\.id/);
    assert.match(source, /where p\.tenant_id = \$\{tenantId\}/);
    assert.match(source, /and rbs\.tenant_id = p\.tenant_id/);
    assert.match(source, /c\.tenant_id = p\.tenant_id/);
  });
});
