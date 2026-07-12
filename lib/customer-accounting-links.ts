import "server-only";

import { sql } from "drizzle-orm";

import { getDb, type DbClient } from "@/lib/db";
import type { InvoiceProvider } from "@/lib/invoices";

export type CustomerAccountingLinkStatus =
  | "linked"
  | "unlinked"
  | "needs_review"
  | "sync_error";

export type CustomerAccountingLink = {
  createdAt: string;
  customerId: string;
  id: string;
  linkStatus: CustomerAccountingLinkStatus;
  mode: "live" | "test";
  provider: InvoiceProvider;
  providerCustomerCode: string | null;
  providerCustomerId: string | null;
  providerSnapshot: Record<string, unknown>;
  syncedAt: string | null;
  tenantId: string;
  updatedAt: string;
};

export async function getCustomerAccountingLink(input: {
  customerId: string;
  mode: "live" | "test";
  provider: InvoiceProvider;
  tenantId: string;
}) {
  const result = await getDb().execute<CustomerAccountingLink>(sql`
    select
      id,
      tenant_id as "tenantId",
      customer_id as "customerId",
      mode,
      provider,
      provider_customer_id as "providerCustomerId",
      provider_customer_code as "providerCustomerCode",
      link_status as "linkStatus",
      synced_at as "syncedAt",
      provider_snapshot as "providerSnapshot",
      created_at as "createdAt",
      updated_at as "updatedAt"
    from customer_accounting_links
    where tenant_id = ${input.tenantId}
      and customer_id = ${input.customerId}
      and mode = ${input.mode}
      and provider = ${input.provider}::invoice_provider
    limit 1
  `);

  return result.rows[0] ?? null;
}

export async function getLinkedEboekhoudenRelation(input: {
  customerId: string;
  mode: "live" | "test";
  tenantId: string;
}) {
  const link = await getCustomerAccountingLink({
    customerId: input.customerId,
    mode: input.mode,
    provider: "eboekhouden",
    tenantId: input.tenantId,
  });

  return {
    code: link?.providerCustomerCode ?? null,
    id:
      link?.providerCustomerId && Number.isInteger(Number(link.providerCustomerId))
        ? Number(link.providerCustomerId)
        : null,
    linkStatus: link?.linkStatus ?? "unlinked",
    snapshot: link?.providerSnapshot ?? {},
    syncedAt: link?.syncedAt ?? null,
  };
}

export async function upsertCustomerAccountingLink(
  input: {
    customerId: string;
    linkStatus: CustomerAccountingLinkStatus;
    mode: "live" | "test";
    provider: InvoiceProvider;
    providerCustomerCode?: string | null;
    providerCustomerId?: string | null;
    providerSnapshot?: Record<string, unknown>;
    syncedAt?: string | null;
    tenantId: string;
  },
  client?: DbClient,
) {
  const db = client ?? getDb();
  const recordId = `${input.provider}:${input.customerId}:${input.mode}`;
  const result = await db.execute<CustomerAccountingLink>(sql`
    insert into customer_accounting_links (
      id,
      tenant_id,
      customer_id,
      mode,
      provider,
      provider_customer_id,
      provider_customer_code,
      link_status,
      synced_at,
      provider_snapshot,
      created_at,
      updated_at
    ) values (
      ${recordId},
      ${input.tenantId},
      ${input.customerId},
      ${input.mode},
      ${input.provider}::invoice_provider,
      ${input.providerCustomerId ?? null},
      ${input.providerCustomerCode ?? null},
      ${input.linkStatus}::customer_accounting_link_status,
      ${input.syncedAt ?? null},
      ${JSON.stringify(input.providerSnapshot ?? {})}::jsonb,
      now(),
      now()
    )
    on conflict (tenant_id, customer_id, mode, provider)
    do update set
      provider_customer_id = excluded.provider_customer_id,
      provider_customer_code = excluded.provider_customer_code,
      link_status = excluded.link_status,
      synced_at = excluded.synced_at,
      provider_snapshot = excluded.provider_snapshot,
      updated_at = now()
    returning
      id,
      tenant_id as "tenantId",
      customer_id as "customerId",
      mode,
      provider,
      provider_customer_id as "providerCustomerId",
      provider_customer_code as "providerCustomerCode",
      link_status as "linkStatus",
      synced_at as "syncedAt",
      provider_snapshot as "providerSnapshot",
      created_at as "createdAt",
      updated_at as "updatedAt"
  `);

  return result.rows[0] ?? null;
}
