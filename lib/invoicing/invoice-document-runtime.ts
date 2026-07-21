import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { normalizeTrustedInvoicePdfUrl } from "@/lib/invoice-pdf";
import { getStoredInvoiceById } from "@/lib/invoices";
import {
  createInvoiceDocumentService,
  type InvoiceDocumentRecord,
} from "@/lib/invoicing/invoice-document-service";
import { getInvoiceProviderAdapterById } from "@/lib/invoicing/provider-resolver";
import { vercelBlobInvoiceArtifactStore } from "@/lib/invoicing/vercel-blob-artifact-store";

async function getInvoiceDocumentRecord(input: { invoiceId: string; tenantId: string }): Promise<InvoiceDocumentRecord | null> {
  const result = await getDb().execute<InvoiceDocumentRecord>(sql`
    select
      i.id,
      i.tenant_id as "tenantId",
      i.provider,
      i.canonical_invoice_number as "invoiceNumber",
      artifact.private_locator as "artifactKey",
      artifact.sha256 as "artifactSha256"
    from invoices i
    left join lateral (
      select private_locator, sha256
      from invoice_artifacts
      where invoice_id = i.id and tenant_id = i.tenant_id and format = 'pdf'
      order by created_at desc
      limit 1
    ) artifact on true
    where i.id = ${input.invoiceId} and i.tenant_id = ${input.tenantId}
    limit 1
  `);
  return result.rows[0] ?? null;
}

export const invoiceDocumentService = createInvoiceDocumentService({
  artifactStore: vercelBlobInvoiceArtifactStore,
  async getLegacyDocumentUrl(record) {
    const storedInvoice = await getStoredInvoiceById({
      invoiceId: record.id,
      tenantId: record.tenantId,
    });
    if (!storedInvoice || storedInvoice.provider === "kify") return null;
    const provider = getInvoiceProviderAdapterById(storedInvoice.provider);
    return normalizeTrustedInvoicePdfUrl(await provider.getInvoiceDocument({
      invoice: storedInvoice,
      tenantId: record.tenantId,
    }));
  },
  getRecord: getInvoiceDocumentRecord,
});
