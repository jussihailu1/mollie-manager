import type { InvoiceArtifactStore } from "@/lib/invoicing/invoice-artifact-store";

export type InvoiceDocumentRecord = {
  artifactKey?: string | null;
  id: string;
  provider: "eboekhouden" | "kify" | "mollie";
  tenantId: string;
};

export type InvoiceDocumentResult =
  | { contentType: "application/pdf"; source: "kify"; stream: ReadableStream<Uint8Array> }
  | { source: "legacy"; url: string };

export interface InvoiceDocumentService {
  getDocument(input: { invoiceId: string; tenantId: string }): Promise<InvoiceDocumentResult | null>;
}

export function createInvoiceDocumentService(input: {
  artifactStore: InvoiceArtifactStore;
  getLegacyDocumentUrl(record: InvoiceDocumentRecord): Promise<string | null>;
  getRecord(input: { invoiceId: string; tenantId: string }): Promise<InvoiceDocumentRecord | null>;
}): InvoiceDocumentService {
  return {
    async getDocument(request) {
      const record = await input.getRecord(request);
      if (!record || record.tenantId !== request.tenantId) return null;
      if (record.provider === "kify") {
        if (!record.artifactKey) return null;
        return { contentType: "application/pdf", source: "kify", stream: await input.artifactStore.read({ key: record.artifactKey }) };
      }
      const url = await input.getLegacyDocumentUrl(record);
      return url ? { source: "legacy", url } : null;
    },
  };
}
