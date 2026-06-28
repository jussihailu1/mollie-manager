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

export async function getScheduledInvoiceCandidate(scheduleId: string) {
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
      c.eboekhouden_relation_id as "eboekhoudenRelationId"
    from recurring_billing_schedules rbs
    inner join subscriptions s on s.id = rbs.subscription_id
    inner join customers c on c.id = s.customer_id
    where rbs.id = ${scheduleId}
    limit 1
  `);

  return result.rows[0] ?? null;
}
