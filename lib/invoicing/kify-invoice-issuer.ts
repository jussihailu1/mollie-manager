import { createHash } from "node:crypto";

import type { InvoiceArtifactStore } from "@/lib/invoicing/invoice-artifact-store";
import type { CanonicalInvoiceSnapshot, InvoiceDocumentRenderer } from "@/lib/invoicing/invoice-renderer";
import { buildKifyInvoiceArtifactKey } from "@/lib/invoicing/invoice-artifact-key";

export type ClaimedKifyInvoice = {
  attemptNumber: number;
  snapshot: CanonicalInvoiceSnapshot;
  snapshotSha256: string;
};

function validatePdf(bytes: Buffer, contentType: string) {
  if (contentType !== "application/pdf" || bytes.byteLength === 0 || bytes.byteLength > 5 * 1024 * 1024 || !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new Error("Kify renderer did not produce a valid PDF artifact.");
  }
}

export function createKifyInvoiceIssuer(input: {
  artifactStore: InvoiceArtifactStore;
  claim(input: { ownerId: string; ownerType: "payment" | "recurring_schedule"; tenantId: string }): Promise<ClaimedKifyInvoice | null>;
  complete(input: { artifactKey: string; artifactSha256: string; byteSize: number; invoiceId: string; snapshotSha256: string }): Promise<void>;
  fail(input: { invoiceId: string; safeErrorCode: string; snapshotSha256: string }): Promise<void>;
  renderer: InvoiceDocumentRenderer;
}) {
  return {
    async issue(inputToIssue: { ownerId: string; ownerType: "payment" | "recurring_schedule"; tenantId: string }) {
      const claimed = await input.claim(inputToIssue);
      if (!claimed) return { status: "skipped" as const };

      try {
        input.renderer.validate(claimed.snapshot);
        const rendered = await input.renderer.renderPdf(claimed.snapshot);
        validatePdf(rendered.bytes, rendered.contentType);
        const artifactSha256 = createHash("sha256").update(rendered.bytes).digest("hex");
        const artifactKey = buildKifyInvoiceArtifactKey({
          invoiceId: claimed.snapshot.invoiceId,
          mode: claimed.snapshot.mode,
          snapshotSha256: claimed.snapshotSha256,
          tenantId: claimed.snapshot.tenantId,
        });
        const existingArtifact = await input.artifactStore.head({ key: artifactKey });
        const stored = existingArtifact && existingArtifact.byteSize === rendered.bytes.byteLength && existingArtifact.sha256 === artifactSha256
          ? { key: artifactKey, ...existingArtifact }
          : await input.artifactStore.put({
              bytes: rendered.bytes,
              contentType: rendered.contentType,
              key: artifactKey,
              sha256: artifactSha256,
            });
        if (stored.byteSize !== rendered.bytes.byteLength || stored.sha256 !== artifactSha256) {
          throw new Error("Kify artifact verification failed after storage.");
        }
        await input.complete({ artifactKey, artifactSha256, byteSize: stored.byteSize, invoiceId: claimed.snapshot.invoiceId, snapshotSha256: claimed.snapshotSha256 });
        return { invoiceId: claimed.snapshot.invoiceId, invoiceNumber: claimed.snapshot.invoiceNumber, status: "created" as const };
      } catch (error) {
        await input.fail({ invoiceId: claimed.snapshot.invoiceId, safeErrorCode: "KIFY_RENDER_OR_STORAGE_FAILED", snapshotSha256: claimed.snapshotSha256 });
        return { reason: error instanceof Error ? error.message : "Kify invoice issuance failed.", status: "failed" as const };
      }
    },
  };
}
