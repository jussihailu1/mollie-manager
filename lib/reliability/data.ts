import "server-only";

import { sql } from "drizzle-orm";
import { cache } from "react";

import type { DashboardModeFilter } from "@/lib/dashboard-mode";
import { getDb } from "@/lib/db";

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
  mode: "live" | "test" | null;
};

export type WebhookEventOverview = {
  errorMessage: string | null;
  id: string;
  mode: "live" | "test";
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

function toModeParam(mode?: DashboardModeFilter) {
  return !mode || mode === "all" ? null : mode;
}

const alertModeExpression = sql<"live" | "test" | null>`
  coalesce(
    p.mode,
    s.mode,
    c.mode,
    case
      when a.payload ->> 'mode' in ('test', 'live')
        then (a.payload ->> 'mode')::mollie_mode
      else null
    end
  )
`;

const listAlertInboxByMode = cache(async (mode: DashboardModeFilter) => {
  const modeParam = toModeParam(mode);
  const result = await getDb().execute<AlertInboxItem>(sql`
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
        coalesce(customer.full_name, fallback_customer.full_name) as "customerName",
        coalesce(customer.email, fallback_customer.email) as "customerEmail",
        ${alertModeExpression} as "mode"
      from alerts a
      left join payments p on p.id = a.payment_id
      left join subscriptions s on s.id = a.subscription_id
      left join customers customer on customer.id = a.customer_id
      left join customers fallback_customer on fallback_customer.id = coalesce(p.customer_id, s.customer_id)
      left join customers c on c.id = coalesce(customer.id, fallback_customer.id)
      where (${modeParam}::mollie_mode is null or ${alertModeExpression} = ${modeParam})
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

export async function listAlertInbox(options?: {
  mode?: DashboardModeFilter;
}) {
  return listAlertInboxByMode(options?.mode ?? "all");
}

const listRecentWebhookEventsByMode = cache(async (mode: DashboardModeFilter) => {
  const modeParam = toModeParam(mode);
  const result = await getDb().execute<WebhookEventOverview>(sql`
      select
        id,
        mode,
        resource_type as "resourceType",
        resource_id as "resourceId",
        processing_status as "processingStatus",
        error_message as "errorMessage",
        retry_count as "retryCount",
        received_at as "receivedAt",
        processed_at as "processedAt"
      from webhook_events
      where (${modeParam}::mollie_mode is null or mode = ${modeParam})
      order by received_at desc
      limit 12
    `);

  return result.rows;
});

export async function listRecentWebhookEvents(options?: {
  mode?: DashboardModeFilter;
}) {
  return listRecentWebhookEventsByMode(options?.mode ?? "all");
}

const getReliabilitySnapshotByMode = cache(async (mode: DashboardModeFilter) => {
  const modeParam = toModeParam(mode);
  const result = await getDb().execute<ReliabilitySnapshot>(sql`
      with alert_records as (
        select
          a.status,
          ${alertModeExpression} as mode
        from alerts a
        left join payments p on p.id = a.payment_id
        left join subscriptions s on s.id = a.subscription_id
        left join customers customer on customer.id = a.customer_id
        left join customers fallback_customer on fallback_customer.id = coalesce(p.customer_id, s.customer_id)
        left join customers c on c.id = coalesce(customer.id, fallback_customer.id)
      )
      select
        count(*) filter (
          where status = 'open'
            and (${modeParam}::mollie_mode is null or mode = ${modeParam})
        )::int as "openAlertCount",
        count(*) filter (
          where status in ('open', 'acknowledged')
            and (${modeParam}::mollie_mode is null or mode = ${modeParam})
        )::int as "unresolvedAlertCount",
        (
          select count(*)::int
          from webhook_events w
          where w.processing_status = 'failed'
            and (${modeParam}::mollie_mode is null or w.mode = ${modeParam})
        ) as "failedWebhookCount",
        (
          select max(w.received_at)
          from webhook_events w
          where (${modeParam}::mollie_mode is null or w.mode = ${modeParam})
        ) as "lastReceivedWebhookAt",
        (
          select max(w.processed_at)
          from webhook_events w
          where (${modeParam}::mollie_mode is null or w.mode = ${modeParam})
        ) as "lastProcessedWebhookAt"
      from alert_records
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

export async function getReliabilitySnapshot(options?: {
  mode?: DashboardModeFilter;
}) {
  return getReliabilitySnapshotByMode(options?.mode ?? "all");
}
