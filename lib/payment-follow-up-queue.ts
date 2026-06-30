import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import {
  derivePaymentFollowUpState,
  type PaymentFollowUpAlertStatus,
  type PaymentFollowUpDeliveryStatus,
  type PaymentFollowUpNotificationStatus,
  type PaymentFollowUpTaskStatus,
  type PaymentFollowUpUrgency,
} from "@/lib/payment-follow-up-state";

type PaymentFollowUpRow = {
  alertId: string | null;
  alertStatus: Exclude<PaymentFollowUpAlertStatus, "absent"> | null;
  attemptCount: number | null;
  claimedAt: string | null;
  createdAt: string;
  customerId: string | null;
  customerName: string | null;
  failedAt: string | null;
  notificationStatus: Exclude<PaymentFollowUpNotificationStatus, "absent"> | null;
  paymentId: string;
  sentAt: string | null;
};

export type PaymentFollowUpQueueItem = {
  alertId: string | null;
  attemptCount: number;
  createdAt: string;
  customerId: string | null;
  customerName: string | null;
  href: string;
  id: string;
  notificationLabel: string;
  notificationOccurredAt: string | null;
  notificationStatus: PaymentFollowUpDeliveryStatus;
  recommendedAction: string;
  taskLabel: string;
  taskStatus: PaymentFollowUpTaskStatus;
  urgency: PaymentFollowUpUrgency;
};

export async function listPaymentFollowUpQueue(options: {
  limit?: number;
  mode: MollieMode;
  tenantId: string;
}): Promise<PaymentFollowUpQueueItem[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
  const mode = options.mode;
  const tenantId = options.tenantId;
  const result = await getDb().execute<PaymentFollowUpRow>(sql`
    with candidate_payments as (
      select
        p.customer_id,
        p.id,
        p.mode,
        coalesce(p.disputed_at, p.failed_at, p.created_at) as follow_up_created_at
      from payments p
      where p.tenant_id = ${tenantId}
        and p.mode = ${mode}
        and (
          p.disputed_at is not null
          or p.mollie_status in ('failed', 'canceled', 'expired', 'charged_back')
          or p.recurring_collection_state in (
            'failed_needs_review',
            'mandate_problem_review',
            'reversal_critical_review'
          )
          or exists (
            select 1
            from alerts candidate_alert
            where candidate_alert.payment_id = p.id
              and exists (
                select 1
                from payments p2
                where p2.id = candidate_alert.payment_id
                  and p2.tenant_id = ${tenantId}
              )
              and candidate_alert.payload ->> 'notificationPolicy'
                = 'failed_payment_customer_notification'
          )
          or exists (
            select 1
            from customer_payment_notifications candidate_notification
            where candidate_notification.mode = p.mode
              and candidate_notification.payment_id = p.id
              and candidate_notification.notification_type = 'failed_payment'
          )
        )
    ),
    ranked_alerts as (
      select
        a.id,
        a.payment_id,
        a.status,
        row_number() over (
          partition by candidate.mode, candidate.id
          order by
            case a.status
              when 'open' then 0
              when 'acknowledged' then 1
              else 2
            end,
            a.created_at desc,
            a.id
        ) as position
      from candidate_payments candidate
      inner join alerts a on a.payment_id = candidate.id
      where exists (
        select 1
        from payments p2
        where p2.id = a.payment_id
          and p2.tenant_id = ${tenantId}
      )
        and a.payload ->> 'notificationPolicy'
        = 'failed_payment_customer_notification'
    )
    select
      p.id as "paymentId",
      p.follow_up_created_at as "createdAt",
      c.id as "customerId",
      coalesce(nullif(c.metadata ->> 'businessName', ''), c.full_name) as "customerName",
      follow_up_alert.id as "alertId",
      follow_up_alert.status as "alertStatus",
      cpn.status as "notificationStatus",
      cpn.attempt_count as "attemptCount",
      cpn.claimed_at as "claimedAt",
      cpn.sent_at as "sentAt",
      cpn.failed_at as "failedAt"
    from candidate_payments p
    left join customers c
      on c.id = p.customer_id
      and c.tenant_id = ${tenantId}
      and c.mode = p.mode
    left join ranked_alerts follow_up_alert
      on follow_up_alert.payment_id = p.id
      and follow_up_alert.position = 1
    left join customer_payment_notifications cpn
      on cpn.payment_id = p.id
      and cpn.mode = p.mode
      and cpn.notification_type = 'failed_payment'
    order by
      case follow_up_alert.status
        when 'open' then 0
        when 'acknowledged' then 1
        when 'resolved' then 2
        else 0
      end,
      p.follow_up_created_at asc
    limit ${limit}
  `);

  return result.rows.map((row) => {
    const presentation = derivePaymentFollowUpState({
      alertStatus: row.alertStatus ?? "absent",
      attemptCount: row.attemptCount ?? 0,
      claimedAt: row.claimedAt,
      failedAt: row.failedAt,
      notificationStatus: row.notificationStatus ?? "absent",
      sentAt: row.sentAt,
    });

    return {
      alertId: row.alertId,
      attemptCount: row.attemptCount ?? 0,
      createdAt: row.createdAt,
      customerId: row.customerId,
      customerName: row.customerName,
      href: `/payments?focus=${row.paymentId}`,
      id: row.paymentId,
      notificationLabel: presentation.notificationLabel,
      notificationOccurredAt: row.sentAt ?? row.failedAt ?? row.claimedAt,
      notificationStatus: presentation.notificationStatus,
      recommendedAction: presentation.recommendedAction,
      taskLabel: presentation.taskLabel,
      taskStatus: presentation.taskStatus,
      urgency: presentation.urgency,
    };
  });
}
