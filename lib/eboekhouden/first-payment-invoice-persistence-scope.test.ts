import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("first-payment invoice persistence scope", () => {
  it("threads tenant id through first-payment invoice claims and writes", () => {
    const source = readFileSync(
      "lib/eboekhouden/first-payment-invoice-persistence.ts",
      "utf8",
    );

    assert.match(source, /tenantId: string/);
    assert.match(source, /tenantId: input\.candidate\.tenantId/);
    assert.match(
      source,
      /where id = \$\{input\.paymentId\}[\s\S]*and tenant_id = \$\{input\.tenantId\}/,
    );
    assert.match(
      source,
      /where id = \$\{input\.candidate\.paymentId\}[\s\S]*and tenant_id = \$\{input\.candidate\.tenantId\}[\s\S]*and invoice_state = 'invoice_creating'/,
    );
  });
});
