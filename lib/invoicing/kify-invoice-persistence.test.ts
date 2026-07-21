import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("Kify invoice persistence", () => {
  const source = readFileSync("lib/invoicing/kify-invoice-persistence.ts", "utf8");

  it("claims explicitly tenant-scoped owners and freezes canonical invoice data", () => {
    assert.match(source, /and tenant_id = \$\{input\.tenantId\}/);
    assert.match(source, /allocateKifyInvoiceNumber\(\{ client: tx/);
    assert.match(source, /canonical_snapshot_sha256/);
    assert.match(source, /invoice_render_attempts/);
  });

  it("keeps retries on the recorded snapshot and only completes after artifact persistence", () => {
    assert.match(source, /invoice\.provider !== "kify"/);
    assert.match(source, /canonicalStatus === "issued"/);
    assert.match(source, /insert into invoice_artifacts/);
    assert.match(source, /canonical_status = 'issued'/);
    assert.match(source, /canonical_status = 'render_failed'/);
  });
});
