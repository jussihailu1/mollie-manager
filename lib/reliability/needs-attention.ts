import "server-only";

import { sql } from "drizzle-orm";
import { cache } from "react";

import type { DashboardModeFilter } from "@/lib/dashboard-mode";
import { getDb } from "@/lib/db";

export type NeedsAttentionItemType =
  | "expired_payment"
  | "failed_payment"
  | "failed_webhook"
  | "mandate_problem"
  | "payment_action_required_subscription"
  | "reversed_payment"
  | "subscription_out_of_sync";

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
  type: "payment" | "subscription" | "system";
};

function toModeParam(mode?: DashboardModeFilter) {
  return !mode || mode === "all" ? null : mode;
}

const listNeedsAttentionItemsByMode = cache(async (
  mode: DashboardModeFilter,
  limit: number,
) => {
  const modeParam = toModeParam(mode);
  const normalizedLimit = Math.max(1, Math.min(limit, 50));
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
      left join customers c on c.id = p.customer_id
      where
        (${modeParam}::mollie_mode is null or p.mode = ${modeParam})
        and (
          p.disputed_at is not null
          or p.mollie_status in ('failed', 'expired')
          or p.recurring_collection_state in (
            'failed_needs_review',
            'mandate_problem_review',
            'reversal_critical_review'
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
      inner join customers c on c.id = s.customer_id
      where
        (${modeParam}::mollie_mode is null or s.mode = ${modeParam})
        and s.local_status in ('payment_action_required', 'out_of_sync')

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

export async function listNeedsAttentionItems(options?: {
  limit?: number;
  mode?: DashboardModeFilter;
}) {
  return listNeedsAttentionItemsByMode(
    options?.mode ?? "all",
    options?.limit ?? 20,
  );
}

