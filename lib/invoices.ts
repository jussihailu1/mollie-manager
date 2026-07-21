import "server-only";

import { sql } from "drizzle-orm";

import { getDb, type DbClient } from "@/lib/db";

export type InvoiceProvider = "eboekhouden" | "kify" | "mollie";
export type InvoiceOwnerType = "payment" | "recurring_schedule";

export type StoredInvoiceRecord = {
  createdAt: string;
  id: string;
  mode: "live" | "test";
  ownerId: string;
  ownerType: InvoiceOwnerType;
  provider: InvoiceProvider;
  providerCustomerId: string | null;
  providerDocumentUrl: string | null;
  providerInvoiceId: string | null;
  providerInvoiceNumber: string | null;
  providerSnapshot: Record<string, unknown>;
  syncedAt: string | null;
  tenantId: string;
  updatedAt: string;
};

export function getStoredInvoiceIdentifier(invoice: {
  providerInvoiceId: string | null;
  providerInvoiceNumber: string | null;
}) {
  return invoice.providerInvoiceNumber ?? invoice.providerInvoiceId ?? null;
}

export async function getStoredInvoiceByOwner(input: {
  ownerId: string;
  ownerType: InvoiceOwnerType;
  tenantId: string;
}) {
  const result = await getDb().execute<StoredInvoiceRecord>(sql`
    select
      id,
      tenant_id as "tenantId",
      mode,
      owner_type as "ownerType",
      owner_id as "ownerId",
      provider,
      provider_invoice_id as "providerInvoiceId",
      provider_invoice_number as "providerInvoiceNumber",
      provider_customer_id as "providerCustomerId",
      provider_document_url as "providerDocumentUrl",
      provider_snapshot as "providerSnapshot",
      synced_at as "syncedAt",
      created_at as "createdAt",
      updated_at as "updatedAt"
    from invoices
    where tenant_id = ${input.tenantId}
      and owner_type = ${input.ownerType}::invoice_owner_type
      and owner_id = ${input.ownerId}
    limit 1
  `);

  return result.rows[0] ?? null;
}

export async function saveStoredInvoice(
  input: {
    createdAt?: string | null;
    mode: "live" | "test";
    ownerId: string;
    ownerType: InvoiceOwnerType;
    provider: InvoiceProvider;
    providerCustomerId?: string | null;
    providerDocumentUrl?: string | null;
    providerInvoiceId?: string | null;
    providerInvoiceNumber?: string | null;
    providerSnapshot?: Record<string, unknown>;
    syncedAt?: string | null;
    tenantId: string;
  },
  client?: DbClient,
) {
  const db = client ?? getDb();
  const recordId = `${input.ownerType}:${input.ownerId}`;
  const result = await db.execute<StoredInvoiceRecord>(sql`
    insert into invoices (
      id,
      tenant_id,
      mode,
      owner_type,
      owner_id,
      provider,
      provider_invoice_id,
      provider_invoice_number,
      provider_customer_id,
      provider_document_url,
      provider_snapshot,
      synced_at,
      created_at,
      updated_at
    ) values (
      ${recordId},
      ${input.tenantId},
      ${input.mode},
      ${input.ownerType}::invoice_owner_type,
      ${input.ownerId},
      ${input.provider}::invoice_provider,
      ${input.providerInvoiceId ?? null},
      ${input.providerInvoiceNumber ?? null},
      ${input.providerCustomerId ?? null},
      ${input.providerDocumentUrl ?? null},
      ${JSON.stringify(input.providerSnapshot ?? {})}::jsonb,
      ${input.syncedAt ?? null},
      coalesce(${input.createdAt ?? null}::timestamptz, now()),
      now()
    )
    on conflict (tenant_id, owner_type, owner_id)
    do update set
      provider = excluded.provider,
      provider_invoice_id = excluded.provider_invoice_id,
      provider_invoice_number = excluded.provider_invoice_number,
      provider_customer_id = excluded.provider_customer_id,
      provider_document_url = excluded.provider_document_url,
      provider_snapshot = excluded.provider_snapshot,
      synced_at = excluded.synced_at,
      created_at = coalesce(excluded.created_at, invoices.created_at),
      updated_at = now()
    returning
      id,
      tenant_id as "tenantId",
      mode,
      owner_type as "ownerType",
      owner_id as "ownerId",
      provider,
      provider_invoice_id as "providerInvoiceId",
      provider_invoice_number as "providerInvoiceNumber",
      provider_customer_id as "providerCustomerId",
      provider_document_url as "providerDocumentUrl",
      provider_snapshot as "providerSnapshot",
      synced_at as "syncedAt",
      created_at as "createdAt",
      updated_at as "updatedAt"
  `);

  return result.rows[0] ?? null;
}
