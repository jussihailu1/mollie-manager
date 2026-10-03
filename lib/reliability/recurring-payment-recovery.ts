import "server-only";

import { sql } from "drizzle-orm";
import { getDb, type DbClient } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import { syncSubscriptionByLocalId } from "./subscription-sync-operations";

export async function discoverRecurringPaymentsBatch(input: {
  tenantId: string;
  mode: MollieMode;
  limit: number;
}) {
  const limit = Math.min(Math.max(Math.trunc(input.limit), 1), 25);
  const subscriptions = await getDb().execute<{ id: string }>(sql`
    select s.id from subscriptions s
    where s.tenant_id = ${input.tenantId} and s.mode = ${input.mode}
      and s.mollie_subscription_id is not null
      and (s.local_status = 'active' or exists (
        select 1 from recurring_billing_schedules r
        where r.subscription_id = s.id and r.tenant_id = s.tenant_id
          and r.payment_id is null and r.planned_collection_date <= current_date
      ))
    order by (s.metadata ->> 'paymentDiscoveryAttemptedAt')::timestamptz asc nulls first, s.id
    limit ${limit}
  `);
  let repairedCount = 0;
  let failedCount = 0;
  for (const subscription of subscriptions.rows) {
    await getDb().execute(sql`
      update subscriptions set metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('paymentDiscoveryAttemptedAt', now())
      where id = ${subscription.id} and tenant_id = ${input.tenantId} and mode = ${input.mode}
    `);
    try {
      await syncSubscriptionByLocalId(subscription.id, {
        tenantId: input.tenantId,
        strictMode: true,
        reconciliationMode: "sync_only",
        actor: { kind: "system" },
      });
      repairedCount++;
    } catch {
      // Keep last_synced_at unchanged on provider failure, so the next run
      // retries it. Other subscriptions and invoice work may still progress.
      failedCount++;
    }
  }
  const assigned = await bindRecoveredWebhookEvents(input);
  return { repairedCount, failedCount, totalChecked: subscriptions.rows.length, assignedWebhookCount: assigned };
}

export async function bindRecoveredWebhookEvents(input: { tenantId: string; mode: MollieMode }, client?: DbClient) {
  // Ownership comes exclusively from recovered local provider state. Require
  // a unique owner across the platform before attaching old unassigned events.
  const result = await (client ?? getDb()).execute(sql`
    with resources as (
      select mollie_payment_id as resource_id, tenant_id, mode from payments
      where mollie_payment_id is not null
      union all
      select mollie_subscription_id, tenant_id, mode from subscriptions
      where mollie_subscription_id is not null
      union all
      select mollie_payment_link_id, tenant_id, mode from payment_links
      where mollie_payment_link_id is not null
    ), owners as (
      select resource_id, min(tenant_id) as tenant_id, min(mode::text)::mollie_mode as mode
      from resources group by resource_id
      having count(distinct (tenant_id, mode)) = 1
    )
    update webhook_events w set tenant_id = o.tenant_id, mode = o.mode
    from owners o
    where w.resource_id = o.resource_id and w.tenant_id is null
      and w.processing_status in ('failed', 'pending')
      and o.tenant_id = ${input.tenantId} and o.mode = ${input.mode}
    returning w.id
  `);
  return result.rows.length;
}
