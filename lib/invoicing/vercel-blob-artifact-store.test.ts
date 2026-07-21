import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("Vercel Blob invoice artifact store", () => {
  const source = readFileSync(resolve("lib/invoicing/vercel-blob-artifact-store.ts"), "utf8");
  const keySource = readFileSync(resolve("lib/invoicing/invoice-artifact-key.ts"), "utf8");
  it("uses deterministic tenant keys and private access without replacement", () => {
    assert.match(keySource, /invoices\/\$\{input\.tenantId\}\/\$\{input\.mode\}/);
    assert.match(source, /access: "private"/);
    assert.match(source, /BLOB_READ_WRITE_TOKEN/);
    assert.match(source, /token: process\.env\.BLOB_READ_WRITE_TOKEN/);
    assert.match(source, /BlobNotFoundError/);
    assert.match(source, /addRandomSuffix: false/);
    assert.match(source, /allowOverwrite: false/);
    assert.match(source, /Invoice artifact replacement is not allowed/);
  });
});
