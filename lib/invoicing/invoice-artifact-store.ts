export type InvoiceArtifactLocator = { key: string };

export type InvoiceArtifactWrite = {
  bytes: Buffer;
  contentType: "application/pdf";
  key: string;
  sha256: string;
};

export type InvoiceArtifactMetadata = {
  byteSize: number;
  contentType: "application/pdf";
  sha256: string;
};

export type StoredInvoiceArtifact = InvoiceArtifactLocator & InvoiceArtifactMetadata;

export interface InvoiceArtifactStore {
  head(locator: InvoiceArtifactLocator): Promise<InvoiceArtifactMetadata | null>;
  put(input: InvoiceArtifactWrite): Promise<StoredInvoiceArtifact>;
  read(locator: InvoiceArtifactLocator): Promise<ReadableStream<Uint8Array>>;
}

export function createFakeInvoiceArtifactStore(): InvoiceArtifactStore {
  const artifacts = new Map<string, { bytes: Buffer; metadata: InvoiceArtifactMetadata }>();
  return {
    async head(locator) {
      return artifacts.get(locator.key)?.metadata ?? null;
    },
    async put(input) {
      if (artifacts.has(input.key)) {
        throw new Error("Invoice artifact replacement is not allowed.");
      }
      const metadata = { byteSize: input.bytes.byteLength, contentType: input.contentType, sha256: input.sha256 } as const;
      artifacts.set(input.key, { bytes: Buffer.from(input.bytes), metadata });
      return { key: input.key, ...metadata };
    },
    async read(locator) {
      const artifact = artifacts.get(locator.key);
      if (!artifact) throw new Error("Invoice artifact was not found.");
      return new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(artifact.bytes)); controller.close(); } });
    },
  };
}
