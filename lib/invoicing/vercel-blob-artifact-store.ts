import "server-only";

import { get, head, put } from "@vercel/blob";

import type { InvoiceArtifactStore, StoredInvoiceArtifact } from "@/lib/invoicing/invoice-artifact-store";

// Prefer an explicitly configured token when both local credentials and Vercel
// OIDC are present. The Blob SDK otherwise selects OIDC first, which is not
// available in a local development environment.
const blobAuthOptions = process.env.BLOB_READ_WRITE_TOKEN ? { token: process.env.BLOB_READ_WRITE_TOKEN } : {};

export function buildKifyInvoiceArtifactKey(input: { invoiceId: string; mode: "live" | "test"; snapshotSha256: string; tenantId: string }) {
  return `invoices/${input.tenantId}/${input.mode}/${input.invoiceId}/${input.snapshotSha256}.pdf`;
}

export const vercelBlobInvoiceArtifactStore: InvoiceArtifactStore = {
  async head(locator) {
    const result = await head(locator.key, blobAuthOptions);
    return result ? { byteSize: result.size, contentType: "application/pdf", sha256: result.pathname.split("/").at(-1)?.replace(".pdf", "") ?? "" } : null;
  },
  async put(input): Promise<StoredInvoiceArtifact> {
    const existing = await head(input.key, blobAuthOptions);
    if (existing) throw new Error("Invoice artifact replacement is not allowed.");
    await put(input.key, input.bytes, {
      ...blobAuthOptions,
      access: "private",
      addRandomSuffix: false,
      contentType: input.contentType,
      allowOverwrite: false,
    });
    const stored = await head(input.key, blobAuthOptions);
    if (!stored || stored.size !== input.bytes.byteLength) throw new Error("Stored invoice artifact size mismatch.");
    return { key: input.key, byteSize: stored.size, contentType: input.contentType, sha256: input.sha256 };
  },
  async read(locator) {
    const result = await get(locator.key, { ...blobAuthOptions, access: "private", useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) throw new Error("Invoice artifact was not found.");
    return result.stream;
  },
};
