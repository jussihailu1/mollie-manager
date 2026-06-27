import "server-only";

import { sql } from "drizzle-orm";

import type { DashboardModeFilter } from "@/lib/dashboard-mode";
import { getDb } from "@/lib/db";
import type { InvoiceActor, RetryDeliveryCandidate } from "@/lib/invoice-delivery-batch";
import { deliverCustomerInvoiceEmail } from "@/lib/invoice-delivery";
import {
  resendCustomerInvoiceEmailWithDependencies,
  type CustomerInvoiceResendTargetInput,
} from "@/lib/customer-invoice-resend-flow";
import { getSingleTenantIdOrThrow } from "@/lib/tenants";

export { resendCustomerInvoiceEmailWithDependencies };

export type CustomerInvoiceOwnerType = "payment" | "recurring_schedule";

type ResendTargetRow = {
  customerEmail: string | null;
  customerId: string | null;
  eboekhoudenInvoiceId: string | null;
  eboekhoudenInvoiceNumber: string | null;
  eboekhoudenInvoicePdfUrl: string | null;
  entityId: string;
  invoiceType: "first_payment" | "recurring";
  mode: "live" | "test";
  plannedCollectionDate: string | null;
  subscriptionId: string | null;
};

type ResendTarget = RetryDeliveryCandidate;

function toModeParam(mode?: DashboardModeFilter) {
  return !mode || mode === "all" ? null : mode;
}

async function resolveTenantId(tenantId?: string) {
  return tenantId ?? (await getSingleTenantIdOrThrow());
}

export async function loadCustomerInvoiceResendTarget(
  input: CustomerInvoiceResendTargetInput,
): Promise<ResendTarget | null> {
  const tenantId = await resolveTenantId(input.tenantId);
  const modeParam = toModeParam(input.mode);
  const result = await getDb().execute<ResendTargetRow>(sql`
    select *
    from (
      select
        p.id as "entityId",
        p.mode,
        p.customer_id as "customerId",
        p.subscription_id as "subscriptionId",
        c.email as "customerEmail",
        p.eboekhouden_invoice_id as "eboekhoudenInvoiceId",
        p.eboekhouden_invoice_number as "eboekhoudenInvoiceNumber",
        coalesce(
          nullif(p.metadata ->> 'invoiceDocumentUrl', ''),
          nullif(p.metadata #>> '{eboekhoudenInvoice,urlPdfFile}', '')
        ) as "eboekhoudenInvoicePdfUrl",
        'first_payment' as "invoiceType",
        null::text as "plannedCollectionDate"
      from payments p
      inner join customers c
        on c.id = p.customer_id
        and c.mode = p.mode
        and c.tenant_id = p.tenant_id
      where ${input.ownerType} = 'payment'
        and p.id = ${input.ownerId}
        and p.customer_id = ${input.customerId}
        and p.tenant_id = ${tenantId}
        and (${modeParam}::mollie_mode is null or p.mode = ${modeParam})
        and p.invoice_state in ('invoice_created', 'invoice_sent')
        and (p.eboekhouden_invoice_id is not null or p.eboekhouden_invoice_number is not null)

      union all

      select
        rbs.id as "entityId",
        rbs.mode,
        s.customer_id as "customerId",
        rbs.subscription_id as "subscriptionId",
        c.email as "customerEmail",
        rbs.eboekhouden_invoice_id as "eboekhoudenInvoiceId",
        rbs.eboekhouden_invoice_number as "eboekhoudenInvoiceNumber",
        coalesce(
          nullif(rbs.metadata ->> 'invoiceDocumentUrl', ''),
          nullif(rbs.metadata #>> '{eboekhoudenInvoice,urlPdfFile}', '')
        ) as "eboekhoudenInvoicePdfUrl",
        'recurring' as "invoiceType",
        rbs.planned_collection_date::text as "plannedCollectionDate"
      from recurring_billing_schedules rbs
      inner join subscriptions s
        on s.id = rbs.subscription_id
        and s.mode = rbs.mode
        and s.tenant_id = rbs.tenant_id
      inner join customers c
        on c.id = s.customer_id
        and c.mode = rbs.mode
        and c.tenant_id = rbs.tenant_id
      where ${input.ownerType} = 'recurring_schedule'
        and rbs.id = ${input.ownerId}
        and s.customer_id = ${input.customerId}
        and rbs.tenant_id = ${tenantId}
        and (${modeParam}::mollie_mode is null or rbs.mode = ${modeParam})
        and rbs.invoice_state in ('invoice_created', 'invoice_sent')
        and (
          rbs.eboekhouden_invoice_id is not null
          or rbs.eboekhouden_invoice_number is not null
        )
    ) target
    limit 1
  `);

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    customerEmail: row.customerEmail,
    customerId: row.customerId,
    eboekhoudenInvoiceId: row.eboekhoudenInvoiceId,
    eboekhoudenInvoiceNumber: row.eboekhoudenInvoiceNumber,
    eboekhoudenInvoicePdfUrl: row.eboekhoudenInvoicePdfUrl,
    entityId: row.entityId,
    invoiceType: row.invoiceType,
    mode: row.mode,
    plannedCollectionDate: row.plannedCollectionDate,
    subscriptionId: row.subscriptionId,
  };
}

export async function resendCustomerInvoiceEmail(input: CustomerInvoiceResendTargetInput & {
  actor: InvoiceActor;
}) {
  return resendCustomerInvoiceEmailWithDependencies(input, {
    deliverCustomerInvoiceEmail,
    loadTarget: loadCustomerInvoiceResendTarget,
  });
}
