import "server-only";

import { get, head, put } from "@vercel/blob";

import type { InvoiceArtifactStore, StoredInvoiceArtifact } from "@/lib/invoicing/invoice-artifact-store";
export { buildKifyInvoiceArtifactKey } from "@/lib/invoicing/invoice-artifact-key";

// Prefer an explicitly configured token when both local credentials and Vercel
// OIDC are present. The Blob SDK otherwise selects OIDC first, which is not
// available in a local development environment.
const blobAuthOptions = process.env.BLOB_READ_WRITE_TOKEN ? { token: process.env.BLOB_READ_WRITE_TOKEN } : {};

async function findBlob(key: string) {
  try {
    return await head(key, blobAuthOptions);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "BlobNotFoundError" || error.message === "Vercel Blob: The requested blob does not exist")
    ) {
      return null;
    }
    throw error;
  }
}

export const vercelBlobInvoiceArtifactStore: InvoiceArtifactStore = {
  async head(locator) {
    const result = await findBlob(locator.key);
    return result ? { byteSize: result.size, contentType: "application/pdf", sha256: result.pathname.split("/").at(-1)?.replace(".pdf", "") ?? "" } : null;
  },
  async put(input): Promise<StoredInvoiceArtifact> {
    const existing = await findBlob(input.key);
    if (existing) throw new Error("Invoice artifact replacement is not allowed.");
    await put(input.key, input.bytes, {
      ...blobAuthOptions,
      access: "private",
      addRandomSuffix: false,
      contentType: input.contentType,
      allowOverwrite: false,
    });
    const stored = await findBlob(input.key);
    if (!stored || stored.size !== input.bytes.byteLength) throw new Error("Stored invoice artifact size mismatch.");
    return { key: input.key, byteSize: stored.size, contentType: input.contentType, sha256: input.sha256 };
  },
  async read(locator) {
    const result = await get(locator.key, { ...blobAuthOptions, access: "private", useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) throw new Error("Invoice artifact was not found.");
    return result.stream;
  },
};
