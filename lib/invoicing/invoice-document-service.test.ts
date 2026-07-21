import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFakeInvoiceArtifactStore } from "@/lib/invoicing/invoice-artifact-store";
import { createInvoiceDocumentService } from "@/lib/invoicing/invoice-document-service";

describe("invoice document service", () => {
  it("routes Kify artifacts and legacy documents with tenant fencing", async () => {
    const store = createFakeInvoiceArtifactStore();
    await store.put({ bytes: Buffer.from("%PDF-fake"), contentType: "application/pdf", key: "kify.pdf", sha256: "h" });
    const service = createInvoiceDocumentService({
      artifactStore: store,
      async getLegacyDocumentUrl() { return "https://trusted.example/invoice.pdf"; },
      async getRecord({ invoiceId, tenantId }) { return invoiceId === "kify" ? { artifactKey: "kify.pdf", id: "kify", provider: "kify" as const, tenantId } : { id: "legacy", provider: "mollie" as const, tenantId: "tenant-a" }; },
    });
    assert.equal((await service.getDocument({ invoiceId: "kify", tenantId: "tenant-a" }))?.source, "kify");
    assert.equal((await service.getDocument({ invoiceId: "legacy", tenantId: "tenant-a" }))?.source, "legacy");
    assert.equal(await service.getDocument({ invoiceId: "legacy", tenantId: "tenant-b" }), null);
  });

  it("retains Kify document metadata with the private stream", async () => {
    const store = createFakeInvoiceArtifactStore();
    await store.put({ bytes: Buffer.from("%PDF-fake"), contentType: "application/pdf", key: "kify.pdf", sha256: "h" });
    const service = createInvoiceDocumentService({
      artifactStore: store,
      async getLegacyDocumentUrl() { return null; },
      async getRecord() {
        return { artifactKey: "kify.pdf", artifactSha256: "h", id: "kify", invoiceNumber: "K-2026-001", provider: "kify", tenantId: "tenant-a" };
      },
    });
    const document = await service.getDocument({ invoiceId: "kify", tenantId: "tenant-a" });
    assert.deepEqual(document && document.source === "kify" ? { filename: document.filename, sha256: document.sha256 } : null, { filename: "K-2026-001.pdf", sha256: "h" });
  });
});
