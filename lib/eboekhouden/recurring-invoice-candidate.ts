import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";

export type ScheduledInvoiceCandidate = {
  amountValue: string;
  customerEmail: string;
  customerId: string;
  eboekhoudenRelationId: number | null;
  invoiceSendDueDate: string;
  mode: "live" | "test";
  plannedCollectionDate: string;
  scheduleId: string;
  subscriptionDescription: string;
  subscriptionId: string;
  tenantId: string;
};

export async function getScheduledInvoiceCandidate(
  scheduleId: string,
  tenantId: string,
) {
  const result = await getDb().execute<ScheduledInvoiceCandidate>(sql`
    select
      rbs.id as "scheduleId",
      rbs.subscription_id as "subscriptionId",
      rbs.mode,
      rbs.tenant_id as "tenantId",
      rbs.invoice_send_due_date::text as "invoiceSendDueDate",
      rbs.planned_collection_date::text as "plannedCollectionDate",
      rbs.amount_value::text as "amountValue",
      s.customer_id as "customerId",
      s.description as "subscriptionDescription",
      c.email as "customerEmail",
      case
        when cal.provider_customer_id ~ '^[0-9]+$'
          then cal.provider_customer_id::int
        else null
      end as "eboekhoudenRelationId"
    from recurring_billing_schedules rbs
    inner join subscriptions s
      on s.id = rbs.subscription_id
      and s.tenant_id = rbs.tenant_id
    inner join customers c
      on c.id = s.customer_id
      and c.mode = rbs.mode
      and c.tenant_id = rbs.tenant_id
    left join customer_accounting_links cal
      on cal.customer_id = c.id
      and cal.tenant_id = c.tenant_id
      and cal.mode = c.mode
      and cal.provider = 'eboekhouden'
    where rbs.id = ${scheduleId}
      and rbs.tenant_id = ${tenantId}
    limit 1
  `);

  return result.rows[0] ?? null;
}
