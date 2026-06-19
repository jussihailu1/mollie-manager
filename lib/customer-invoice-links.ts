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
  invoicePdfUrl: string | null;
  invoiceState: string;
  ownerId: string;
  ownerType: "payment" | "recurring_schedule";
  plannedCollectionDate: string | null;
};

type CustomerInvoiceLinkRow = Omit<CustomerInvoiceLink, "invoicePdfUrl"> & {
  candidateInvoicePdfUrl: string | null;
};

function toModeParam(mode?: DashboardModeFilter) {
  return !mode || mode === "all" ? null : mode;
}

function sanitizeInvoiceLink(row: CustomerInvoiceLinkRow): CustomerInvoiceLink {
  return {
    createdAt: row.createdAt,
    eboekhoudenInvoiceId: row.eboekhoudenInvoiceId,
    eboekhoudenInvoiceNumber: row.eboekhoudenInvoiceNumber,
    invoicePdfUrl: normalizeTrustedInvoicePdfUrl(row.candidateInvoicePdfUrl),
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
        p.eboekhouden_invoice_id as "eboekhoudenInvoiceId",
        p.eboekhouden_invoice_number as "eboekhoudenInvoiceNumber",
        coalesce(
          nullif(p.metadata ->> 'invoiceDocumentUrl', ''),
          nullif(p.metadata #>> '{eboekhoudenInvoice,urlPdfFile}', '')
        ) as "candidateInvoicePdfUrl",
        p.invoice_created_at as "createdAt",
        null::text as "plannedCollectionDate"
      from payments p
      where p.customer_id = ${customerId}
        and (${modeParam}::mollie_mode is null or p.mode = ${modeParam})
        and p.invoice_state in ('invoice_created', 'invoice_sent')
        and (p.eboekhouden_invoice_id is not null or p.eboekhouden_invoice_number is not null)

      union all

      select
        rbs.id as "ownerId",
        'recurring_schedule' as "ownerType",
        rbs.invoice_state::text as "invoiceState",
        rbs.eboekhouden_invoice_id as "eboekhoudenInvoiceId",
        rbs.eboekhouden_invoice_number as "eboekhoudenInvoiceNumber",
        coalesce(
          nullif(rbs.metadata ->> 'invoiceDocumentUrl', ''),
          nullif(rbs.metadata #>> '{eboekhoudenInvoice,urlPdfFile}', '')
        ) as "candidateInvoicePdfUrl",
        rbs.invoice_created_at as "createdAt",
        rbs.planned_collection_date::text as "plannedCollectionDate"
      from recurring_billing_schedules rbs
      inner join subscriptions s on s.id = rbs.subscription_id and s.mode = rbs.mode
      where s.customer_id = ${customerId}
        and (${modeParam}::mollie_mode is null or rbs.mode = ${modeParam})
        and rbs.invoice_state in ('invoice_created', 'invoice_sent')
        and (
          rbs.eboekhouden_invoice_id is not null
          or rbs.eboekhouden_invoice_number is not null
        )
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
}) {
  return listCustomerInvoiceLinksByMode(
    options.customerId,
    options.mode ?? "all",
    options.limit ?? 20,
  );
}
