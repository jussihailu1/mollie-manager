import "server-only";

import { cache } from "react";

import { query } from "@/lib/db";

export type AlertInboxItem = {
  createdAt: string;
  customerEmail: string | null;
  customerId: string | null;
  customerName: string | null;
  emailSentAt: string | null;
  id: string;
  message: string;
  paymentId: string | null;
  severity: "critical" | "warning" | "info";
  status: "acknowledged" | "open" | "resolved";
  subscriptionId: string | null;
  title: string;
};

export type WebhookEventOverview = {
  errorMessage: string | null;
  id: string;
  processedAt: string | null;
  processingStatus: string;
  receivedAt: string;
  resourceId: string | null;
  resourceType: string | null;
  retryCount: number;
};

export type ReliabilitySnapshot = {
  failedWebhookCount: number;
  lastProcessedWebhookAt: string | null;
  lastReceivedWebhookAt: string | null;
  openAlertCount: number;
  unresolvedAlertCount: number;
};

export const listAlertInbox = cache(async () => {
  const result = await query<AlertInboxItem>(`
    select
      a.id,
      a.severity,
      a.status,
      a.title,
      a.message,
      a.customer_id as "customerId",
      a.subscription_id as "subscriptionId",
      a.payment_id as "paymentId",
      a.email_sent_at as "emailSentAt",
      a.created_at as "createdAt",
      c.full_name as "customerName",
      c.email as "customerEmail"
    from alerts a
    left join customers c on c.id = a.customer_id
    order by
      case a.status
        when 'open' then 0
        when 'acknowledged' then 1
        else 2
      end,
      a.created_at desc
  `);

  return result.rows;
});

export const listRecentWebhookEvents = cache(async () => {
  const result = await query<WebhookEventOverview>(`
    select
      id,
      resource_type as "resourceType",
      resource_id as "resourceId",
      processing_status as "processingStatus",
      error_message as "errorMessage",
      retry_count as "retryCount",
      received_at as "receivedAt",
      processed_at as "processedAt"
    from webhook_events
    order by received_at desc
    limit 12
  `);

  return result.rows;
});

export const getReliabilitySnapshot = cache(async () => {
  const result = await query<ReliabilitySnapshot>(`
    select
      count(*) filter (where a.status = 'open')::int as "openAlertCount",
      count(*) filter (where a.status in ('open', 'acknowledged'))::int as "unresolvedAlertCount",
      (
        select count(*)::int
        from webhook_events w
        where w.processing_status = 'failed'
      ) as "failedWebhookCount",
      (
        select max(w.received_at)
        from webhook_events w
      ) as "lastReceivedWebhookAt",
      (
        select max(w.processed_at)
        from webhook_events w
      ) as "lastProcessedWebhookAt"
    from alerts a
  `);

  return (
    result.rows[0] ?? {
      failedWebhookCount: 0,
      lastProcessedWebhookAt: null,
      lastReceivedWebhookAt: null,
      openAlertCount: 0,
      unresolvedAlertCount: 0,
    }
  );
});
