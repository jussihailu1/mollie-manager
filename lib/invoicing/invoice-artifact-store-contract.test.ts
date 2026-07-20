import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFakeInvoiceArtifactStore } from "@/lib/invoicing/invoice-artifact-store";

describe("invoice artifact store contract", () => {
  it("stores and reads PDFs behind replaceable interface without replacement", async () => {
    const store = createFakeInvoiceArtifactStore();
    await store.put({ bytes: Buffer.from("%PDF-fake"), contentType: "application/pdf", key: "invoices/t/test/i/hash.pdf", sha256: "hash" });
    assert.equal((await store.head({ key: "invoices/t/test/i/hash.pdf" }))?.byteSize, 9);
    await assert.rejects(store.put({ bytes: Buffer.from("%PDF-fake"), contentType: "application/pdf", key: "invoices/t/test/i/hash.pdf", sha256: "hash" }));
  });
});
