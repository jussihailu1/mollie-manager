import "server-only";

import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";

export type KifyInvoiceArtifact = { invoiceNumber: string; locator: string; sha256: string };

export async function getKifyInvoiceArtifact(input: { invoiceId: string; tenantId: string }) {
  const result = await getDb().execute<KifyInvoiceArtifact>(sql`
    select i.canonical_invoice_number as "invoiceNumber", ia.private_locator as locator, ia.sha256
    from invoices i
    inner join invoice_artifacts ia on ia.invoice_id = i.id and ia.tenant_id = i.tenant_id
    where i.id = ${input.invoiceId} and i.tenant_id = ${input.tenantId} and i.provider::text = 'kify'
    order by ia.created_at desc limit 1
  `);
  return result.rows[0] ?? null;
}
