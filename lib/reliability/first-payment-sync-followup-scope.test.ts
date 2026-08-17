import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("first-payment sync follow-up tenant scope", () => {
  it("passes tenant context to first-payment invoice normalization", () => {
    const source = readFileSync("lib/reliability/first-payment-sync-followup.ts", "utf8");

    assert.match(
      source,
      /normalizeFirstPaymentInvoiceStates\(\{[\s\S]*tenantId: input\.tenantId,[\s\S]*\}\)/,
    );
  });
});
