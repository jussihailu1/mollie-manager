import "server-only";

import { sql } from "drizzle-orm";
import { cache } from "react";

import { getDb } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import type { CancellationEffect } from "@/lib/subscription-policy";
import { getSingleTenantIdOrThrow } from "@/lib/tenants";

export type PendingSubscriptionOperationRequest = {
  cancellationEffect: CancellationEffect;
  createdAt: string;
  customerEmail: string | null;
  customerId: string;
  customerName: string | null;
  href: string;
  id: string;
  operation: "cancel" | "pause" | "resume";
  paidPeriodEndAt: string | null;
  recommendedAction: string;
  requestedEffectiveAt: string;
  status: "pending" | "processing" | "scheduled";
  subscriptionId: string;
  summary: string;
  title: string;
};

async function resolveTenantId(tenantId?: string) {
  return tenantId ?? (await getSingleTenantIdOrThrow());
}

const listPendingSubscriptionOperationRequestsCached = cache(async (
  mode: MollieMode,
  tenantId: string,
  customerId: string | null,
  limit: number,
) => {
  const normalizedLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
  const result = await getDb().execute<PendingSubscriptionOperationRequest>(sql`
    select
      sor.id,
      sor.operation,
      sor.status,
      sor.subscription_id as "subscriptionId",
      sor.requested_effective_at as "requestedEffectiveAt",
      sor.paid_period_end_at as "paidPeriodEndAt",
      sor.cancellation_effect as "cancellationEffect",
      sor.created_at as "createdAt",
      c.id as "customerId",
      coalesce(nullif(c.metadata ->> 'businessName', ''), c.full_name) as "customerName",
      c.email as "customerEmail",
      concat('/customers?focus=', c.id) as "href",
      case
        when sor.operation = 'cancel' then 'Pending cancellation request'
        when sor.operation = 'pause' then 'Pending pause request'
        else 'Pending resume request'
      end as title,
      case
        when sor.operation = 'cancel'
          then 'Cancellation intent was recorded for review only. No provider, invoice, payment, or service change has happened yet.'
        when sor.operation = 'pause'
          then 'Pause intent was recorded for review only. No provider, invoice, payment, or service change has happened yet.'
        else 'Resume intent was recorded for review only. No provider, invoice, payment, or service change has happened yet.'
      end as summary,
      case
        when sor.status = 'processing'
          then 'Finish manual review before any provider mutation or lifecycle change.'
        when sor.status = 'scheduled'
          then 'Confirm timing and customer impact before execution; no automatic mutation should happen yet.'
        when sor.operation = 'cancel' and sor.cancellation_effect = 'end_of_paid_period'
          then 'Review effective date and paid-period end before any future manual execution.'
        else 'Review effective date and policy before any future manual execution.'
      end as "recommendedAction"
    from subscription_operation_requests sor
    inner join subscriptions s
      on s.id = sor.subscription_id
      and s.tenant_id = sor.tenant_id
      and s.mode = sor.mode
    inner join customers c
      on c.id = s.customer_id
      and c.tenant_id = s.tenant_id
      and c.mode = s.mode
    where sor.tenant_id = ${tenantId}
      and s.tenant_id = ${tenantId}
      and c.tenant_id = ${tenantId}
      and sor.mode = ${mode}
      and sor.status in ('pending', 'scheduled', 'processing')
      and (${customerId}::text is null or c.id = ${customerId})
    order by sor.created_at desc, sor.id desc
    limit ${normalizedLimit}
  `);

  return result.rows;
});

export async function listPendingSubscriptionOperationRequests(options: {
  customerId?: string;
  limit?: number;
  mode: MollieMode;
  tenantId?: string;
}) {
  const tenantId = await resolveTenantId(options.tenantId);
  return listPendingSubscriptionOperationRequestsCached(
    options.mode,
    tenantId,
    options.customerId ?? null,
    options.limit ?? 25,
  );
}
