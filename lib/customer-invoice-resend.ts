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

export { resendCustomerInvoiceEmailWithDependencies };

export type CustomerInvoiceOwnerType = "payment" | "recurring_schedule";

type ResendTargetRow = {
  customerEmail: string | null;
  customerId: string | null;
  entityId: string;
  invoiceDocumentUrl: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceProvider: "eboekhouden" | "kify" | "mollie";
  invoiceType: "first_payment" | "recurring";
  mode: "live" | "test";
  plannedCollectionDate: string | null;
  subscriptionId: string | null;
  tenantId: string;
};

type ResendTarget = RetryDeliveryCandidate;

function toModeParam(mode?: DashboardModeFilter) {
  return !mode || mode === "all" ? null : mode;
}

export async function loadCustomerInvoiceResendTarget(
  input: CustomerInvoiceResendTargetInput,
): Promise<ResendTarget | null> {
  const tenantId = input.tenantId;
  const modeParam = toModeParam(input.mode);
  const result = await getDb().execute<ResendTargetRow>(sql`
    select *
    from (
      select
        p.id as "entityId",
        p.mode,
        p.tenant_id as "tenantId",
        p.customer_id as "customerId",
        p.subscription_id as "subscriptionId",
        c.email as "customerEmail",
        i.provider as "invoiceProvider",
        i.id as "invoiceId",
        coalesce(i.canonical_invoice_number, i.provider_invoice_number, i.provider_invoice_id) as "invoiceNumber",
        coalesce(
          nullif(i.provider_document_url, ''),
          nullif(p.metadata ->> 'invoiceDocumentUrl', '')
        ) as "invoiceDocumentUrl",
        'first_payment' as "invoiceType",
        null::text as "plannedCollectionDate"
      from payments p
      inner join invoices i
        on i.owner_type = 'payment'
        and i.owner_id = p.id
        and i.tenant_id = p.tenant_id
        and i.mode = p.mode
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

      union all

      select
        rbs.id as "entityId",
        rbs.mode,
        rbs.tenant_id as "tenantId",
        s.customer_id as "customerId",
        rbs.subscription_id as "subscriptionId",
        c.email as "customerEmail",
        i.provider as "invoiceProvider",
        i.id as "invoiceId",
        coalesce(i.canonical_invoice_number, i.provider_invoice_number, i.provider_invoice_id) as "invoiceNumber",
        coalesce(
          nullif(i.provider_document_url, ''),
          nullif(rbs.metadata ->> 'invoiceDocumentUrl', '')
        ) as "invoiceDocumentUrl",
        'recurring' as "invoiceType",
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
    entityId: row.entityId,
    invoiceDocumentUrl: row.invoiceDocumentUrl,
    invoiceId: row.invoiceId,
    invoiceNumber: row.invoiceNumber,
    invoiceProvider: row.invoiceProvider,
    invoiceType: row.invoiceType,
    mode: row.mode,
    plannedCollectionDate: row.plannedCollectionDate,
    subscriptionId: row.subscriptionId,
    tenantId: row.tenantId,
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
