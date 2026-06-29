import "server-only";

import { sql } from "drizzle-orm";
import { cache } from "react";

import type { DashboardModeFilter } from "@/lib/dashboard-mode";
import { getDb } from "@/lib/db";
import { REPAIR_STALE_AFTER_MS } from "@/lib/freshness";
import { listPendingSubscriptionOperationRequests } from "@/lib/pending-subscription-operation-requests";

export type NeedsAttentionItemType =
  | "customer_sync_stale"
  | "eboekhouden_relation_problem"
  | "expired_payment"
  | "failed_payment"
  | "failed_first_payment_invoice"
  | "failed_invoice_delivery"
  | "failed_recurring_invoice"
  | "failed_webhook"
  | "missing_mandate"
  | "mandate_problem"
  | "payment_action_required_subscription"
  | "pending_subscription_cancellation"
  | "payment_sync_stale"
  | "reversed_payment"
  | "subscription_out_of_sync"
  | "subscription_sync_stale";

export type NeedsAttentionItem = {
  createdAt: string;
  customerEmail: string | null;
  customerId: string | null;
  customerName: string | null;
  entityId: string;
  href: string;
  id: string;
  itemType: NeedsAttentionItemType;
  recommendedAction: string;
  severity: "critical" | "warning";
  summary: string;
  title: string;
  type: "customer" | "payment" | "subscription" | "system";
};

function toModeParam(mode?: DashboardModeFilter) {
  return !mode || mode === "all" ? null : mode;
}

const listBaseNeedsAttentionItemsByMode = cache(async (
  mode: DashboardModeFilter,
  limit: number,
  tenantId: string,
) => {
  const modeParam = toModeParam(mode);
  const normalizedLimit = Math.max(1, Math.min(limit, 50));
  const staleAfterMs = REPAIR_STALE_AFTER_MS;
  const result = await getDb().execute<NeedsAttentionItem>(sql`
    select *
    from (
      select
        p.id,
        p.id as "entityId",
        'payment' as "type",
        case
          when p.disputed_at is not null
            or p.recurring_collection_state in ('mandate_problem_review', 'reversal_critical_review')
            then 'critical'
          else 'warning'
        end as "severity",
        case
          when p.disputed_at is not null
            or p.recurring_collection_state = 'reversal_critical_review'
            then 'reversed_payment'
          when p.recurring_collection_state = 'mandate_problem_review'
            then 'mandate_problem'
          when p.recurring_collection_state = 'failed_needs_review'
            then 'failed_payment'
          when p.mollie_status = 'expired'
            then 'expired_payment'
          else 'failed_payment'
        end as "itemType",
        case
          when p.disputed_at is not null
            or p.recurring_collection_state = 'reversal_critical_review'
            then 'Payment reversed or disputed'
          when p.recurring_collection_state = 'mandate_problem_review'
            then 'Mandate problem'
          when p.recurring_collection_state = 'failed_needs_review'
            then 'Recurring payment needs review'
          when p.mollie_status = 'expired'
            then 'Expired payment'
          else 'Failed payment'
        end as "title",
        case
          when p.disputed_at is not null
            or p.recurring_collection_state = 'reversal_critical_review'
            then 'A payment was reversed or disputed. The invoice obligation may still be open.'
          when p.recurring_collection_state = 'mandate_problem_review'
            then 'A recurring payment failed with a possible mandate or bank-account problem.'
          when p.recurring_collection_state = 'failed_needs_review'
            then 'A recurring payment failed or stayed pending beyond the safe processing window.'
          when p.mollie_status = 'expired'
            then 'A checkout expired before the customer completed payment.'
          else 'A payment failed and needs review before any follow-up action.'
        end as "summary",
        case
          when p.disputed_at is not null
            or p.recurring_collection_state = 'reversal_critical_review'
            then 'Review Mollie and e-Boekhouden before changing service or billing state.'
          when p.recurring_collection_state = 'mandate_problem_review'
            then 'Ask for a valid mandate or alternative payment path before relying on automatic collection.'
          when p.recurring_collection_state = 'failed_needs_review'
            then 'Keep the existing invoice open and review manually before retrying.'
          when p.mollie_status = 'expired'
            then 'Decide whether the customer still needs a new payment link or setup step.'
          else 'Review the payment and customer before taking follow-up action.'
        end as "recommendedAction",
        coalesce(p.disputed_at, p.failed_at, p.created_at) as "createdAt",
        c.id as "customerId",
        coalesce(nullif(c.metadata ->> 'businessName', ''), c.full_name) as "customerName",
        c.email as "customerEmail",
        concat('/payments?focus=', p.id) as "href"
      from payments p
      left join customers c on c.id = p.customer_id and c.tenant_id = p.tenant_id
      where
        p.tenant_id = ${tenantId}
        and (${modeParam}::mollie_mode is null or p.mode = ${modeParam})
        and (
          p.disputed_at is not null
          or p.mollie_status in ('failed', 'expired')
          or p.recurring_collection_state in (
            'failed_needs_review',
            'mandate_problem_review',
            'reversal_critical_review'
          )
        )
        and not (
          exists (
            select 1
            from alerts resolved_follow_up
            where resolved_follow_up.payment_id = p.id
              and resolved_follow_up.payload ->> 'notificationPolicy'
                = 'failed_payment_customer_notification'
              and resolved_follow_up.status = 'resolved'
          )
          and not exists (
            select 1
            from alerts active_follow_up
            where active_follow_up.payment_id = p.id
              and active_follow_up.payload ->> 'notificationPolicy'
                = 'failed_payment_customer_notification'
              and active_follow_up.status in ('open', 'acknowledged')
          )
        )

      union all

      select
        s.id,
        s.id as "entityId",
        'subscription' as "type",
        case
          when s.local_status = 'out_of_sync' then 'critical'
          else 'warning'
        end as "severity",
        case
          when s.local_status = 'out_of_sync'
            then 'subscription_out_of_sync'
          else 'payment_action_required_subscription'
        end as "itemType",
        case
          when s.local_status = 'out_of_sync' then 'Subscription out of sync'
          else 'Subscription needs payment action'
        end as "title",
        case
          when s.local_status = 'out_of_sync' then 'The local subscription state no longer matches the latest Mollie state.'
          else 'The subscription is waiting on payment-related intervention.'
        end as "summary",
        case
          when s.local_status = 'out_of_sync' then 'Run sync-only repair first, then review before changing subscription state.'
          else 'Review the latest payment and subscription before taking manual action.'
        end as "recommendedAction",
        s.updated_at as "createdAt",
        c.id as "customerId",
        coalesce(nullif(c.metadata ->> 'businessName', ''), c.full_name) as "customerName",
        c.email as "customerEmail",
        concat('/customers?focus=', c.id) as "href"
      from subscriptions s
      inner join customers c on c.id = s.customer_id and c.tenant_id = s.tenant_id
      where
        s.tenant_id = ${tenantId}
        and (${modeParam}::mollie_mode is null or s.mode = ${modeParam})
        and s.local_status in ('payment_action_required', 'out_of_sync')

      union all

      select
        p.id,
        p.id as "entityId",
        'payment' as "type",
        'critical' as "severity",
        'failed_first_payment_invoice' as "itemType",
        'First-payment invoice failed' as "title",
        'The first-payment invoice was not created or recovered in e-Boekhouden.' as "summary",
        'Review the e-Boekhouden invoice error, relation link, and duplicate-reference evidence before retrying.',
        coalesce(p.invoice_failed_at, p.updated_at, p.created_at) as "createdAt",
        c.id as "customerId",
        coalesce(nullif(c.metadata ->> 'businessName', ''), c.full_name) as "customerName",
        c.email as "customerEmail",
        concat('/payments?focus=', p.id) as "href"
      from payments p
      left join customers c on c.id = p.customer_id and c.tenant_id = p.tenant_id
      where
        p.tenant_id = ${tenantId}
        and (${modeParam}::mollie_mode is null or p.mode = ${modeParam})
        and p.payment_type = 'first'
        and p.invoice_state = 'invoice_failed'

      union all

      select
        rbs.id,
        rbs.id as "entityId",
        'subscription' as "type",
        'critical' as "severity",
        'failed_recurring_invoice' as "itemType",
        'Recurring invoice failed' as "title",
        'The recurring invoice for this billing period was not created or recovered in e-Boekhouden.' as "summary",
        'Review the existing schedule and e-Boekhouden reference before retrying so the billing period is not invoiced twice.',
        coalesce(rbs.invoice_failed_at, rbs.updated_at, rbs.created_at) as "createdAt",
        c.id as "customerId",
        coalesce(nullif(c.metadata ->> 'businessName', ''), c.full_name) as "customerName",
        c.email as "customerEmail",
        concat('/customers?focus=', c.id) as "href"
      from recurring_billing_schedules rbs
      inner join subscriptions s on s.id = rbs.subscription_id and s.tenant_id = rbs.tenant_id
      inner join customers c on c.id = s.customer_id and c.tenant_id = rbs.tenant_id and c.mode = rbs.mode
      where
        rbs.tenant_id = ${tenantId}
        and (${modeParam}::mollie_mode is null or rbs.mode = ${modeParam})
        and rbs.invoice_state = 'invoice_failed'

      union all

      select
        concat('delivery:', p.id) as id,
        p.id as "entityId",
        'payment' as "type",
        case
          when lower(coalesce(p.metadata ->> 'invoiceDeliveryPermanentFailure', '')) = 'true'
            then 'critical'
          else 'warning'
        end as "severity",
        'failed_invoice_delivery' as "itemType",
        case
          when lower(coalesce(p.metadata ->> 'invoiceDeliveryPermanentFailure', '')) = 'true'
            then 'Invoice delivery permanently failed'
          else 'Invoice delivery needs retry'
        end as "title",
        'The invoice exists in e-Boekhouden, but app email delivery did not complete.' as "summary",
        'Check mail settings and retry delivery; do not create another invoice for this payment.',
        coalesce(
          nullif(p.metadata ->> 'invoiceDeliveryAttemptedAt', '')::timestamptz,
          p.invoice_created_at,
          p.updated_at,
          p.created_at
        ) as "createdAt",
        c.id as "customerId",
        coalesce(nullif(c.metadata ->> 'businessName', ''), c.full_name) as "customerName",
        c.email as "customerEmail",
        concat('/payments?focus=', p.id) as "href"
      from payments p
      left join customers c on c.id = p.customer_id and c.tenant_id = p.tenant_id
      where
        p.tenant_id = ${tenantId}
        and (${modeParam}::mollie_mode is null or p.mode = ${modeParam})
        and p.payment_type = 'first'
        and p.invoice_state = 'invoice_created'
        and p.invoice_sent_at is null
        and coalesce(p.metadata ->> 'invoiceDeliveryStatus', '') = 'failed'

      union all

      select
        concat('delivery:', rbs.id) as id,
        rbs.id as "entityId",
        'subscription' as "type",
        case
          when lower(coalesce(rbs.metadata ->> 'invoiceDeliveryPermanentFailure', '')) = 'true'
            then 'critical'
          else 'warning'
        end as "severity",
        'failed_invoice_delivery' as "itemType",
        case
          when lower(coalesce(rbs.metadata ->> 'invoiceDeliveryPermanentFailure', '')) = 'true'
            then 'Invoice delivery permanently failed'
          else 'Invoice delivery needs retry'
        end as "title",
        'The invoice exists in e-Boekhouden, but app email delivery did not complete.' as "summary",
        'Check mail settings and retry delivery; do not create another invoice for this billing period.',
        coalesce(
          nullif(rbs.metadata ->> 'invoiceDeliveryAttemptedAt', '')::timestamptz,
          rbs.invoice_created_at,
          rbs.updated_at,
          rbs.created_at
        ) as "createdAt",
        c.id as "customerId",
        coalesce(nullif(c.metadata ->> 'businessName', ''), c.full_name) as "customerName",
        c.email as "customerEmail",
        concat('/customers?focus=', c.id) as "href"
      from recurring_billing_schedules rbs
      inner join subscriptions s on s.id = rbs.subscription_id and s.tenant_id = rbs.tenant_id
      inner join customers c on c.id = s.customer_id and c.tenant_id = rbs.tenant_id and c.mode = rbs.mode
      where
        rbs.tenant_id = ${tenantId}
        and (${modeParam}::mollie_mode is null or rbs.mode = ${modeParam})
        and rbs.invoice_state = 'invoice_created'
        and rbs.invoice_sent_at is null
        and coalesce(rbs.metadata ->> 'invoiceDeliveryStatus', '') = 'failed'

      union all

      select
        concat('relation:', c.id) as id,
        c.id as "entityId",
        'customer' as "type",
        case
          when c.eboekhouden_link_status in ('needs_review', 'sync_error')
            then 'critical'
          else 'warning'
        end as "severity",
        'eboekhouden_relation_problem' as "itemType",
        case
          when c.eboekhouden_link_status = 'sync_error'
            then 'e-Boekhouden relation sync failed'
          when c.eboekhouden_link_status = 'needs_review'
            then 'e-Boekhouden relation needs review'
          else 'Missing e-Boekhouden relation'
        end as "title",
        'This customer needs a verified e-Boekhouden relation before invoice automation can proceed safely.' as "summary",
        'Open the customer and link or repair the e-Boekhouden relation before creating invoices.',
        coalesce(c.eboekhouden_synced_at, c.updated_at, c.created_at) as "createdAt",
        c.id as "customerId",
        coalesce(nullif(c.metadata ->> 'businessName', ''), c.full_name) as "customerName",
        c.email as "customerEmail",
        concat('/customers?focus=', c.id) as "href"
      from customers c
      where
        c.tenant_id = ${tenantId}
        and (${modeParam}::mollie_mode is null or c.mode = ${modeParam})
        and c.archived_at is null
        and c.eboekhouden_link_status in ('unlinked', 'needs_review', 'sync_error')
        and (
          exists (
            select 1
            from payments p2
            where p2.customer_id = c.id
              and p2.tenant_id = c.tenant_id
              and p2.mode = c.mode
              and p2.invoice_state in ('pending_invoice', 'invoice_failed')
          )
          or exists (
            select 1
            from subscriptions s2
            where s2.customer_id = c.id
              and s2.tenant_id = c.tenant_id
              and s2.mode = c.mode
              and s2.local_status in ('awaiting_first_payment', 'mandate_pending', 'active', 'payment_action_required')
          )
        )

      union all

      select
        concat('missing-mandate:', s.id) as id,
        s.id as "entityId",
        'subscription' as "type",
        'warning' as "severity",
        'missing_mandate' as "itemType",
        'Subscription missing usable mandate' as "title",
        'This subscription needs a valid mandate before automatic collection can be trusted.' as "summary",
        'Ask the customer to complete mandate setup or choose a manual payment path before relying on collection.',
        coalesce(s.updated_at, s.created_at) as "createdAt",
        c.id as "customerId",
        coalesce(nullif(c.metadata ->> 'businessName', ''), c.full_name) as "customerName",
        c.email as "customerEmail",
        concat('/customers?focus=', c.id) as "href"
      from subscriptions s
      inner join customers c on c.id = s.customer_id and c.tenant_id = s.tenant_id and c.mode = s.mode
      left join mandates m
        on m.id = s.mandate_id
        and m.tenant_id = s.tenant_id
        and m.mode = s.mode
      where
        s.tenant_id = ${tenantId}
        and (${modeParam}::mollie_mode is null or s.mode = ${modeParam})
        and s.local_status in ('awaiting_first_payment', 'mandate_pending', 'active', 'payment_action_required')
        and (s.mandate_id is null or coalesce(m.is_valid, false) = false)

      union all

      select
        concat('stale-customer:', c.id) as id,
        c.id as "entityId",
        'customer' as "type",
        'warning' as "severity",
        'customer_sync_stale' as "itemType",
        'Customer sync is stale' as "title",
        'The customer has not been refreshed from Mollie recently.' as "summary",
        'Run sync-only repair before making billing or lifecycle decisions for this customer.',
        coalesce(c.last_synced_at, c.created_at) as "createdAt",
        c.id as "customerId",
        coalesce(nullif(c.metadata ->> 'businessName', ''), c.full_name) as "customerName",
        c.email as "customerEmail",
        concat('/customers?focus=', c.id) as "href"
      from customers c
      where
        c.tenant_id = ${tenantId}
        and (${modeParam}::mollie_mode is null or c.mode = ${modeParam})
        and c.archived_at is null
        and c.mollie_customer_id is not null
        and (
          c.last_synced_at is null
          or c.last_synced_at < now() - ${staleAfterMs} * interval '1 millisecond'
        )

      union all

      select
        concat('stale-payment:', p.id) as id,
        p.id as "entityId",
        'payment' as "type",
        'warning' as "severity",
        'payment_sync_stale' as "itemType",
        'Payment sync is stale' as "title",
        'The payment has not been refreshed from Mollie recently.' as "summary",
        'Run sync-only repair before deciding whether the payment succeeded, failed, or needs follow-up.',
        coalesce(p.last_synced_at, p.created_at) as "createdAt",
        c.id as "customerId",
        coalesce(nullif(c.metadata ->> 'businessName', ''), c.full_name) as "customerName",
        c.email as "customerEmail",
        concat('/payments?focus=', p.id) as "href"
      from payments p
      left join customers c on c.id = p.customer_id and c.tenant_id = p.tenant_id and c.mode = p.mode
      where
        p.tenant_id = ${tenantId}
        and (${modeParam}::mollie_mode is null or p.mode = ${modeParam})
        and p.mollie_payment_id is not null
        and (
          p.last_synced_at is null
          or p.last_synced_at < now() - ${staleAfterMs} * interval '1 millisecond'
        )

      union all

      select
        concat('stale-subscription:', s.id) as id,
        s.id as "entityId",
        'subscription' as "type",
        'warning' as "severity",
        'subscription_sync_stale' as "itemType",
        'Subscription sync is stale' as "title",
        'The subscription has not been refreshed from Mollie recently.' as "summary",
        'Run sync-only repair before changing subscription or billing state.',
        coalesce(s.last_synced_at, s.created_at) as "createdAt",
        c.id as "customerId",
        coalesce(nullif(c.metadata ->> 'businessName', ''), c.full_name) as "customerName",
        c.email as "customerEmail",
        concat('/customers?focus=', c.id) as "href"
      from subscriptions s
      inner join customers c on c.id = s.customer_id and c.tenant_id = s.tenant_id and c.mode = s.mode
      where
        s.tenant_id = ${tenantId}
        and (${modeParam}::mollie_mode is null or s.mode = ${modeParam})
        and s.mollie_subscription_id is not null
        and s.local_status not in ('cancelled')
        and (
          s.last_synced_at is null
          or s.last_synced_at < now() - ${staleAfterMs} * interval '1 millisecond'
        )

      union all

      select
        w.id,
        w.id as "entityId",
        'system' as "type",
        'warning' as "severity",
        'failed_webhook' as "itemType",
        'Webhook needs review' as "title",
        'A Mollie webhook failed processing. Reconciliation can rebuild state from Mollie truth.' as "summary",
        'Run sync-only reconciliation or targeted repair; do not act on the raw webhook payload alone.' as "recommendedAction",
        w.received_at as "createdAt",
        null as "customerId",
        null as "customerName",
        null as "customerEmail",
        '/settings' as "href"
      from webhook_events w
      where
        (${modeParam}::mollie_mode is null or w.mode = ${modeParam})
        and w.processing_status = 'failed'
        and (
          exists (
            select 1
            from payments p
            where w.resource_id = p.mollie_payment_id
              and p.tenant_id = ${tenantId}
          )
          or exists (
            select 1
            from subscriptions s
            where w.resource_id = s.mollie_subscription_id
              and s.tenant_id = ${tenantId}
          )
          or exists (
            select 1
            from payment_links pl
            where w.resource_id = pl.mollie_payment_link_id
              and pl.tenant_id = ${tenantId}
          )
        )
    ) items
    order by
      case severity
        when 'critical' then 0
        else 1
      end,
      "createdAt" desc
    limit ${normalizedLimit}
  `);

  return result.rows;
});

function toPendingOperationAttentionItem(
  request: Awaited<
    ReturnType<typeof listPendingSubscriptionOperationRequests>
  >[number],
): NeedsAttentionItem {
  return {
    createdAt: request.createdAt,
    customerEmail: request.customerEmail,
    customerId: request.customerId,
    customerName: request.customerName,
    entityId: request.subscriptionId,
    href: request.href,
    id: `subscription-operation:${request.id}`,
    itemType: "pending_subscription_cancellation",
    recommendedAction: request.recommendedAction,
    severity: "warning",
    summary: request.summary,
    title: request.title,
    type: "subscription",
  };
}

export async function listNeedsAttentionItems(options: {
  limit?: number;
  mode?: DashboardModeFilter;
  tenantId: string;
}) {
  const mode = options?.mode ?? "all";
  const limit = options?.limit ?? 20;
  const baseItems = await listBaseNeedsAttentionItemsByMode(mode, limit, options.tenantId);
  const pendingOperationItems =
    mode === "all"
      ? []
      : await listPendingSubscriptionOperationRequests({ limit, mode, tenantId: options.tenantId });

  return [...baseItems, ...pendingOperationItems.map(toPendingOperationAttentionItem)]
    .sort((left, right) => {
      if (left.severity !== right.severity) {
        return left.severity === "critical" ? -1 : 1;
      }

      return (
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      );
    })
    .slice(0, Math.max(1, Math.min(limit, 50)));
}
