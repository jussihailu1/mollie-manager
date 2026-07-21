import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("Kify invoice document route", () => {
  const source = readFileSync(resolve("app/api/invoices/[invoiceId]/document/route.ts"), "utf8");
  it("requires current tenant and never exposes Blob URLs", () => {
    assert.match(source, /getCurrentTenantSelectionForViewer/);
    assert.match(source, /invoiceDocumentService\.getDocument/);
    assert.match(source, /document\.source === "legacy"/);
    assert.match(source, /private, no-store/);
    assert.doesNotMatch(source, /blob\.vercel-storage\.com/);
  });
});
