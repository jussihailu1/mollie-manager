import "server-only";

import { sql } from "drizzle-orm";
import { cache } from "react";

import type { DashboardModeFilter } from "@/lib/dashboard-mode";
import { getDb } from "@/lib/db";

export type CustomerActivityTimelineItemType =
  | "alert_opened"
  | "audit_event"
  | "customer_created"
  | "customer_note"
  | "failed_payment_notification"
  | "first_payment_invoice"
  | "payment_status"
  | "recurring_invoice"
  | "subscription_consent"
  | "subscription_operation_request"
  | "subscription_status";

export type CustomerActivityTimelineItem = {
  customerId: string;
  entityId: string;
  entityType:
    | "alert"
    | "audit_log"
    | "customer"
    | "customer_note"
    | "customer_payment_notification"
    | "payment"
    | "recurring_billing_schedule"
    | "subscription_operation_request"
    | "subscription"
    | "subscription_onboarding_consent";
  href: string;
  id: string;
  itemType: CustomerActivityTimelineItemType;
  occurredAt: string;
  severity: "critical" | "info" | "warning";
  summary: string;
  title: string;
};

function toModeParam(mode?: DashboardModeFilter) {
  return !mode || mode === "all" ? null : mode;
}

const listCustomerActivityTimelineByMode = cache(async (
  customerId: string,
  mode: DashboardModeFilter,
  limit: number,
) => {
  const modeParam = toModeParam(mode);
  const normalizedLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
  const result = await getDb().execute<CustomerActivityTimelineItem>(sql`
    select *
    from (
      select
        concat('customer:', c.id) as id,
        'customer_created' as "itemType",
        'info' as severity,
        'Customer created' as title,
        'Customer record was created in Mollie Manager.' as summary,
        c.created_at as "occurredAt",
        'customer' as "entityType",
        c.id as "entityId",
        c.id as "customerId",
        concat('/customers?focus=', c.id) as href
      from customers c
      where c.id = ${customerId}
        and (${modeParam}::mollie_mode is null or c.mode = ${modeParam})

      union all

      select
        concat('consent:', soc.id) as id,
        'subscription_consent' as "itemType",
        case when soc.accepted_at is null then 'info' else 'info' end as severity,
        case
          when soc.accepted_at is null then 'Consent link created'
          else 'Recurring billing consent accepted'
        end as title,
        case
          when soc.accepted_at is null then 'Hosted recurring billing consent was prepared for the customer.'
          else 'Customer accepted the recurring billing consent requirements.'
        end as summary,
        coalesce(soc.accepted_at, soc.created_at) as "occurredAt",
        'subscription_onboarding_consent' as "entityType",
        soc.id as "entityId",
        soc.customer_id as "customerId",
        concat('/customers?focus=', soc.customer_id) as href
      from subscription_onboarding_consents soc
      where soc.customer_id = ${customerId}
        and (${modeParam}::mollie_mode is null or soc.mode = ${modeParam})

      union all

      select
        concat('payment:', p.id, ':', coalesce(p.mollie_status, 'unknown')) as id,
        'payment_status' as "itemType",
        case
          when p.disputed_at is not null
            or p.recurring_collection_state = 'reversal_critical_review'
            then 'critical'
          when p.mollie_status in ('failed', 'expired')
            or p.recurring_collection_state in ('failed_needs_review', 'mandate_problem_review')
            then 'warning'
          else 'info'
        end as severity,
        case
          when p.disputed_at is not null
            or p.recurring_collection_state = 'reversal_critical_review'
            then 'Payment reversed or disputed'
          when p.mollie_status = 'paid' then 'Payment paid'
          when p.mollie_status = 'failed' then 'Payment failed'
          when p.mollie_status = 'expired' then 'Payment expired'
          else 'Payment status updated'
        end as title,
        case
          when p.payment_type = 'recurring' then concat('Recurring payment status: ', coalesce(p.mollie_status, 'unknown'), '.')
          when p.payment_type = 'first' then concat('First payment status: ', coalesce(p.mollie_status, 'unknown'), '.')
          else concat('Payment status: ', coalesce(p.mollie_status, 'unknown'), '.')
        end as summary,
        coalesce(p.disputed_at, p.paid_at, p.failed_at, p.updated_at, p.created_at) as "occurredAt",
        'payment' as "entityType",
        p.id as "entityId",
        p.customer_id as "customerId",
        concat('/payments?focus=', p.id) as href
      from payments p
      where p.customer_id = ${customerId}
        and (${modeParam}::mollie_mode is null or p.mode = ${modeParam})

      union all

      select
        concat('first-invoice:', p.id, ':', p.invoice_state) as id,
        'first_payment_invoice' as "itemType",
        case
          when p.invoice_state = 'invoice_failed' then 'critical'
          else 'info'
        end as severity,
        case
          when p.invoice_state = 'invoice_sent' then 'First-payment invoice sent'
          when p.invoice_state = 'invoice_created' then 'First-payment invoice created'
          when p.invoice_state = 'invoice_failed' then 'First-payment invoice failed'
          else 'First-payment invoice updated'
        end as title,
        case
          when p.eboekhouden_invoice_number is not null
            then concat('e-Boekhouden invoice ', p.eboekhouden_invoice_number, ' is ', replace(p.invoice_state::text, '_', ' '), '.')
          else concat('First-payment invoice is ', replace(p.invoice_state::text, '_', ' '), '.')
        end as summary,
        coalesce(p.invoice_sent_at, p.invoice_created_at, p.invoice_failed_at, p.updated_at, p.created_at) as "occurredAt",
        'payment' as "entityType",
        p.id as "entityId",
        p.customer_id as "customerId",
        concat('/payments?focus=', p.id) as href
      from payments p
      where p.customer_id = ${customerId}
        and (${modeParam}::mollie_mode is null or p.mode = ${modeParam})
        and p.payment_type = 'first'
        and p.invoice_state <> 'not_applicable'

      union all

      select
        concat('recurring-invoice:', rbs.id, ':', rbs.invoice_state) as id,
        'recurring_invoice' as "itemType",
        case
          when rbs.invoice_state = 'invoice_failed' then 'critical'
          else 'info'
        end as severity,
        case
          when rbs.invoice_state = 'invoice_sent' then 'Recurring invoice sent'
          when rbs.invoice_state = 'invoice_created' then 'Recurring invoice created'
          when rbs.invoice_state = 'invoice_failed' then 'Recurring invoice failed'
          else 'Recurring invoice updated'
        end as title,
        concat('Billing period ', rbs.planned_collection_date::text, ' invoice is ', replace(rbs.invoice_state::text, '_', ' '), '.') as summary,
        coalesce(rbs.invoice_sent_at, rbs.invoice_created_at, rbs.invoice_failed_at, rbs.updated_at, rbs.created_at) as "occurredAt",
        'recurring_billing_schedule' as "entityType",
        rbs.id as "entityId",
        s.customer_id as "customerId",
        concat('/customers?focus=', s.customer_id) as href
      from recurring_billing_schedules rbs
      inner join subscriptions s on s.id = rbs.subscription_id and s.mode = rbs.mode
      where s.customer_id = ${customerId}
        and (${modeParam}::mollie_mode is null or rbs.mode = ${modeParam})
        and rbs.invoice_state <> 'pending_invoice'

      union all

      select
        concat('subscription-operation:', sor.id) as id,
        'subscription_operation_request' as "itemType",
        case
          when sor.status = 'withdrawn' then 'info'
          when sor.status = 'processing' then 'warning'
          else 'info'
        end as severity,
        case
          when sor.status = 'withdrawn' and sor.operation = 'cancel'
            then 'Cancellation request withdrawn'
          when sor.status = 'withdrawn' and sor.operation = 'pause'
            then 'Pause request withdrawn'
          when sor.status = 'withdrawn'
            then 'Resume request withdrawn'
          when sor.operation = 'cancel' then 'Cancellation request recorded'
          when sor.operation = 'pause' then 'Pause request recorded'
          else 'Resume request recorded'
        end as title,
        case
          when sor.status = 'withdrawn'
            then 'Subscription operation request was withdrawn before any provider change.'
          when sor.operation = 'cancel' and sor.cancellation_effect = 'end_of_paid_period'
            then concat(
              'Cancellation review request targets ',
              sor.requested_effective_at::date::text,
              ' and preserves service through ',
              sor.paid_period_end_at::date::text,
              '.',
            )
          when sor.operation = 'cancel'
            then concat(
              'Cancellation review request targets ',
              sor.requested_effective_at::date::text,
              ' with immediate service end policy.',
            )
          else concat(
            initcap(sor.operation::text),
            ' review request targets ',
            sor.requested_effective_at::date::text,
            '.',
          )
        end as summary,
        coalesce(sor.withdrawn_at, sor.created_at) as "occurredAt",
        'subscription_operation_request' as "entityType",
        sor.id as "entityId",
        s.customer_id as "customerId",
        concat('/customers?focus=', s.customer_id) as href
      from subscription_operation_requests sor
      inner join subscriptions s on s.id = sor.subscription_id and s.mode = sor.mode
      where s.customer_id = ${customerId}
        and (${modeParam}::mollie_mode is null or sor.mode = ${modeParam})

      union all

      select
        concat('subscription:', s.id, ':', s.local_status) as id,
        'subscription_status' as "itemType",
        case
          when s.local_status in ('charged_back', 'out_of_sync') then 'critical'
          when s.local_status = 'payment_action_required' then 'warning'
          else 'info'
        end as severity,
        'Subscription status updated' as title,
        concat('Subscription is ', replace(s.local_status::text, '_', ' '), '.') as summary,
        coalesce(s.updated_at, s.created_at) as "occurredAt",
        'subscription' as "entityType",
        s.id as "entityId",
        s.customer_id as "customerId",
        concat('/customers?focus=', s.customer_id) as href
      from subscriptions s
      where s.customer_id = ${customerId}
        and (${modeParam}::mollie_mode is null or s.mode = ${modeParam})

      union all

      select
        concat('alert:', a.id) as id,
        'alert_opened' as "itemType",
        a.severity,
        a.title,
        a.message as summary,
        a.created_at as "occurredAt",
        'alert' as "entityType",
        a.id as "entityId",
        coalesce(a.customer_id, p.customer_id, s.customer_id) as "customerId",
        case
          when a.payment_id is not null then concat('/payments?focus=', a.payment_id)
          else concat('/customers?focus=', coalesce(a.customer_id, p.customer_id, s.customer_id))
        end as href
      from alerts a
      left join payments p on p.id = a.payment_id
      left join subscriptions s on s.id = a.subscription_id
      left join customers ac on ac.id = a.customer_id
      where coalesce(a.customer_id, p.customer_id, s.customer_id) = ${customerId}
        and (
          ${modeParam}::mollie_mode is null
          or coalesce(p.mode, s.mode, ac.mode) = ${modeParam}
        )

      union all

      select
        concat('failed-payment-notification:', cpn.id) as id,
        'failed_payment_notification' as "itemType",
        case
          when cpn.status = 'failed' then 'warning'
          else 'info'
        end as severity,
        case
          when cpn.status = 'sent' then 'Failed-payment customer email sent'
          when cpn.status = 'failed' then 'Failed-payment customer email failed'
          when cpn.status = 'skipped' then 'Failed-payment customer email skipped'
          else 'Failed-payment customer email prepared'
        end as title,
        concat('Customer failed-payment notification status: ', cpn.status::text, '.') as summary,
        coalesce(cpn.sent_at, cpn.failed_at, cpn.claimed_at) as "occurredAt",
        'customer_payment_notification' as "entityType",
        cpn.id as "entityId",
        coalesce(cpn.customer_id, p.customer_id) as "customerId",
        concat('/payments?focus=', cpn.payment_id) as href
      from customer_payment_notifications cpn
      inner join payments p on p.id = cpn.payment_id
      where coalesce(cpn.customer_id, p.customer_id) = ${customerId}
        and (${modeParam}::mollie_mode is null or cpn.mode = ${modeParam})

      union all

      select
        concat('customer-note:', cn.id) as id,
        'customer_note' as "itemType",
        'info' as severity,
        case
          when cn.source = 'legacy_customer_notes' then 'Legacy customer note'
          else 'Customer note added'
        end as title,
        case
          when length(cn.body) > 180 then concat(left(cn.body, 177), '...')
          else cn.body
        end as summary,
        cn.created_at as "occurredAt",
        'customer_note' as "entityType",
        cn.id as "entityId",
        cn.customer_id as "customerId",
        concat('/customers?focus=', cn.customer_id) as href
      from customer_notes cn
      where cn.customer_id = ${customerId}
        and cn.archived_at is null
        and (${modeParam}::mollie_mode is null or cn.mode = ${modeParam})

      union all

      select
        concat('audit:', al.id) as id,
        'audit_event' as "itemType",
        case when al.outcome = 'failure' then 'warning' else 'info' end as severity,
        'Operator or system action' as title,
        al.summary,
        al.created_at as "occurredAt",
        'audit_log' as "entityType",
        al.id as "entityId",
        ${customerId} as "customerId",
        concat('/customers?focus=', ${customerId}) as href
      from audit_logs al
      left join payments p on al.entity_type = 'payment' and p.id = al.entity_id
      left join subscriptions s on al.entity_type = 'subscription' and s.id = al.entity_id
      where (
          (al.entity_type = 'customer' and al.entity_id = ${customerId})
          or p.customer_id = ${customerId}
          or s.customer_id = ${customerId}
        )
        and (${modeParam}::mollie_mode is null or al.mode = ${modeParam})
    ) timeline
    where "occurredAt" is not null
    order by "occurredAt" desc
    limit ${normalizedLimit}
  `);

  return result.rows;
});

export async function listCustomerActivityTimeline(options: {
  customerId: string;
  limit?: number;
  mode?: DashboardModeFilter;
}) {
  return listCustomerActivityTimelineByMode(
    options.customerId,
    options.mode ?? "all",
    options.limit ?? 50,
  );
}
