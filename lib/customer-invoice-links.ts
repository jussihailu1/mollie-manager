import "server-only";

import { sql } from "drizzle-orm";
import { cache } from "react";

import type { DashboardModeFilter } from "@/lib/dashboard-mode";
import { getDb } from "@/lib/db";
import { normalizeTrustedInvoicePdfUrl } from "@/lib/invoice-pdf";

export type CustomerInvoiceLink = {
  createdAt: string | null;
  eboekhoudenInvoiceId: string | null;
  eboekhoudenInvoiceNumber: string | null;
  invoiceNumber: string | null;
  invoicePdfUrl: string | null;
  invoiceState: string;
  ownerId: string;
  ownerType: "payment" | "recurring_schedule";
  plannedCollectionDate: string | null;
};

type CustomerInvoiceLinkRow = Omit<CustomerInvoiceLink, "invoicePdfUrl"> & {
  candidateInvoicePdfUrl: string | null;
  invoiceRecordId: string;
  invoiceProvider: "eboekhouden" | "kify" | "mollie";
};

function toModeParam(mode?: DashboardModeFilter) {
  return !mode || mode === "all" ? null : mode;
}

function sanitizeInvoiceLink(row: CustomerInvoiceLinkRow): CustomerInvoiceLink {
  return {
    createdAt: row.createdAt,
    eboekhoudenInvoiceId: row.eboekhoudenInvoiceId,
    eboekhoudenInvoiceNumber: row.eboekhoudenInvoiceNumber,
    invoicePdfUrl: row.invoiceProvider === "kify"
      ? `/api/invoices/${encodeURIComponent(row.invoiceRecordId)}/document`
      : normalizeTrustedInvoicePdfUrl(row.candidateInvoicePdfUrl),
    invoiceNumber: row.invoiceNumber,
    invoiceState: row.invoiceState,
    ownerId: row.ownerId,
    ownerType: row.ownerType,
    plannedCollectionDate: row.plannedCollectionDate,
  };
}

const listCustomerInvoiceLinksByMode = cache(async (
  customerId: string,
  mode: DashboardModeFilter,
  limit: number,
  tenantId: string,
) => {
  const modeParam = toModeParam(mode);
  const normalizedLimit = Math.max(1, Math.min(Math.trunc(limit), 50));
  const result = await getDb().execute<CustomerInvoiceLinkRow>(sql`
    select *
    from (
      select
        p.id as "ownerId",
        'payment' as "ownerType",
        p.invoice_state::text as "invoiceState",
        i.provider_invoice_id as "eboekhoudenInvoiceId",
        i.provider_invoice_number as "eboekhoudenInvoiceNumber",
        coalesce(i.canonical_invoice_number, i.provider_invoice_number, i.provider_invoice_id) as "invoiceNumber",
        i.id as "invoiceRecordId",
        i.provider as "invoiceProvider",
        coalesce(
          nullif(i.provider_document_url, ''),
          nullif(p.metadata ->> 'invoiceDocumentUrl', '')
        ) as "candidateInvoicePdfUrl",
        p.invoice_created_at as "createdAt",
        null::text as "plannedCollectionDate"
      from payments p
      inner join invoices i
        on i.owner_type = 'payment'
        and i.owner_id = p.id
        and i.tenant_id = p.tenant_id
        and i.mode = p.mode
      where p.customer_id = ${customerId}
        and p.tenant_id = ${tenantId}
        and (${modeParam}::mollie_mode is null or p.mode = ${modeParam})
        and p.invoice_state in ('invoice_created', 'invoice_sent')

      union all

      select
        rbs.id as "ownerId",
        'recurring_schedule' as "ownerType",
        rbs.invoice_state::text as "invoiceState",
        i.provider_invoice_id as "eboekhoudenInvoiceId",
        i.provider_invoice_number as "eboekhoudenInvoiceNumber",
        coalesce(i.canonical_invoice_number, i.provider_invoice_number, i.provider_invoice_id) as "invoiceNumber",
        i.id as "invoiceRecordId",
        i.provider as "invoiceProvider",
        coalesce(
          nullif(i.provider_document_url, ''),
          nullif(rbs.metadata ->> 'invoiceDocumentUrl', '')
        ) as "candidateInvoicePdfUrl",
        rbs.invoice_created_at as "createdAt",
        rbs.planned_collection_date::text as "plannedCollectionDate"
      from recurring_billing_schedules rbs
      inner join invoices i
        on i.owner_type = 'recurring_schedule'
        and i.owner_id = rbs.id
        and i.tenant_id = rbs.tenant_id
        and i.mode = rbs.mode
      inner join subscriptions s
        on s.id = rbs.subscription_id
        and s.mode = rbs.mode
        and s.tenant_id = rbs.tenant_id
      where s.customer_id = ${customerId}
        and rbs.tenant_id = ${tenantId}
        and (${modeParam}::mollie_mode is null or rbs.mode = ${modeParam})
        and rbs.invoice_state in ('invoice_created', 'invoice_sent')
    ) invoices
    order by coalesce("createdAt", "plannedCollectionDate"::timestamptz) desc nulls last
    limit ${normalizedLimit}
  `);

  return result.rows.map(sanitizeInvoiceLink);
});

export async function listCustomerInvoiceLinks(options: {
  customerId: string;
  limit?: number;
  mode?: DashboardModeFilter;
  tenantId: string;
}) {
  return listCustomerInvoiceLinksByMode(
    options.customerId,
    options.mode ?? "all",
    options.limit ?? 20,
    options.tenantId,
  );
}
