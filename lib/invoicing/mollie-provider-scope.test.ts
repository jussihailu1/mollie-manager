import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("mollie invoice provider setup validation", () => {
  it("uses a read-only sales invoice probe and surfaces Mollie API error text", () => {
    const source = readFileSync(
      resolve("lib/invoicing/providers/mollie.ts"),
      "utf8",
    );

    assert.match(source, /path: "\/sales-invoices\?limit=1"/);
    assert.match(source, /async validateTenantSetup\(input\)/);
    assert.match(source, /typeof errorBody\.error === "string"/);
    assert.match(source, /Mollie Sales Invoice API request failed\./);
  });
});
