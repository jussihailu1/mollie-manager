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
  href: string;
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

export type AuditActivityItem = {
  action: string;
  createdAt: string;
  entityId: string;
  entityType: string;
  id: string;
  mode: "live" | "test" | null;
  outcome: "failure" | "success";
  summary: string;
};

function toModeParam(mode?: DashboardModeFilter) {
  return !mode || mode === "all" ? null : mode;
}

function requireTenantId(tenantId?: string) {
  if (!tenantId) {
    throw new Error("Explicit tenant context is required.");
  }

  return tenantId;
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

const customerBusinessNameExpression = sql<string | null>`
  coalesce(
    nullif(customer.metadata ->> 'businessName', ''),
    nullif(fallback_customer.metadata ->> 'businessName', ''),
    customer.full_name,
    fallback_customer.full_name
  )
`;

const listAlertInboxByMode = cache(async (mode: DashboardModeFilter, tenantId: string) => {
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
        ${customerBusinessNameExpression} as "customerName",
        coalesce(customer.email, fallback_customer.email) as "customerEmail",
        case
          when a.payment_id is not null then concat('/payments?focus=', a.payment_id)
          when coalesce(customer.id, fallback_customer.id) is not null
            then concat('/customers?focus=', coalesce(customer.id, fallback_customer.id))
          else '/notifications'
        end as "href",
        ${alertModeExpression} as "mode"
      from alerts a
      left join payments p
        on p.id = a.payment_id
        and p.tenant_id = ${tenantId}
      left join subscriptions s
        on s.id = a.subscription_id
        and s.tenant_id = ${tenantId}
      left join customers customer
        on customer.id = a.customer_id
        and customer.tenant_id = ${tenantId}
      left join customers fallback_customer
        on fallback_customer.id = coalesce(p.customer_id, s.customer_id)
        and fallback_customer.tenant_id = ${tenantId}
      left join customers c
        on c.id = coalesce(customer.id, fallback_customer.id)
        and c.tenant_id = ${tenantId}
      where (${modeParam}::mollie_mode is null or ${alertModeExpression} = ${modeParam})
        and (
          coalesce(a.payload ->> 'tenantId', '') = ${tenantId}
          or
          customer.id is not null
          or fallback_customer.id is not null
          or p.id is not null
          or s.id is not null
        )
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

export async function listAlertInbox(options: {
  mode?: DashboardModeFilter;
  tenantId: string;
}) {
  return listAlertInboxByMode(options.mode ?? "all", options.tenantId);
}

const listRecentWebhookEventsByMode = cache(async (
  mode: DashboardModeFilter,
  tenantId: string,
) => {
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
        and tenant_id = ${tenantId}
      order by received_at desc
      limit 12
    `);

  return result.rows;
});

export async function listRecentWebhookEvents(options: {
  mode?: DashboardModeFilter;
  tenantId: string;
}) {
  return listRecentWebhookEventsByMode(options.mode ?? "all", options.tenantId);
}

export async function listFailedWebhookEvents(options: {
  limit?: number;
  mode?: DashboardModeFilter;
  tenantId: string;
}) {
  const events = await listRecentWebhookEventsByMode(options.mode ?? "all", options.tenantId);
  const limit = Math.max(1, Math.min(options?.limit ?? 8, 20));

  return events
    .filter(
      (event) => event.processingStatus === "failed" && typeof event.resourceId === "string",
    )
    .slice(0, limit);
}

const getReliabilitySnapshotByMode = cache(async (
  mode: DashboardModeFilter,
  tenantId: string,
) => {
  const modeParam = toModeParam(mode);
  const result = await getDb().execute<ReliabilitySnapshot>(sql`
      with alert_records as (
        select
          a.status,
          ${alertModeExpression} as mode
        from alerts a
        left join payments p
          on p.id = a.payment_id
          and p.tenant_id = ${tenantId}
        left join subscriptions s
          on s.id = a.subscription_id
          and s.tenant_id = ${tenantId}
        left join customers customer
          on customer.id = a.customer_id
          and customer.tenant_id = ${tenantId}
        left join customers fallback_customer
          on fallback_customer.id = coalesce(p.customer_id, s.customer_id)
          and fallback_customer.tenant_id = ${tenantId}
        left join customers c
          on c.id = coalesce(customer.id, fallback_customer.id)
          and c.tenant_id = ${tenantId}
        where (
          coalesce(a.payload ->> 'tenantId', '') = ${tenantId}
          or
          customer.id is not null
          or fallback_customer.id is not null
          or p.id is not null
          or s.id is not null
        )
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
            and w.tenant_id = ${tenantId}
        ) as "failedWebhookCount",
        (
          select max(w.received_at)
          from webhook_events w
          where (${modeParam}::mollie_mode is null or w.mode = ${modeParam})
            and w.tenant_id = ${tenantId}
        ) as "lastReceivedWebhookAt",
        (
          select max(w.processed_at)
          from webhook_events w
          where (${modeParam}::mollie_mode is null or w.mode = ${modeParam})
            and w.tenant_id = ${tenantId}
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
  tenantId?: string;
}) {
  const tenantId = requireTenantId(options?.tenantId);
  return getReliabilitySnapshotByMode(options?.mode ?? "all", tenantId);
}

const listRecentAuditActivityByMode = cache(async (
  mode: DashboardModeFilter,
  tenantId: string,
) => {
  const modeParam = toModeParam(mode);
  const result = await getDb().execute<AuditActivityItem>(sql`
      select
        id,
        action,
        entity_type as "entityType",
        entity_id as "entityId",
        mode,
        outcome,
        summary,
        created_at as "createdAt"
      from audit_logs
      where (${modeParam}::mollie_mode is null or mode = ${modeParam})
        and (
          exists (
            select 1
            from customers c
            where audit_logs.entity_type = 'customer'
              and c.id = audit_logs.entity_id
              and c.tenant_id = ${tenantId}
          )
          or exists (
            select 1
            from payments p
            where audit_logs.entity_type = 'payment'
              and p.id = audit_logs.entity_id
              and p.tenant_id = ${tenantId}
          )
          or exists (
            select 1
            from subscriptions s
            where audit_logs.entity_type = 'subscription'
              and s.id = audit_logs.entity_id
              and s.tenant_id = ${tenantId}
          )
          or exists (
            select 1
            from payment_links pl
            where audit_logs.entity_type = 'payment_link'
              and pl.id = audit_logs.entity_id
              and pl.tenant_id = ${tenantId}
          )
          or exists (
            select 1
            from mandates m
            where audit_logs.entity_type = 'mandate'
              and m.id = audit_logs.entity_id
              and m.tenant_id = ${tenantId}
          )
          or exists (
            select 1
            from subscription_operation_requests sor
            where audit_logs.entity_type = 'subscription_operation_request'
              and sor.id = audit_logs.entity_id
              and sor.tenant_id = ${tenantId}
          )
          or exists (
            select 1
            from recurring_billing_schedules rbs
            where audit_logs.entity_type = 'recurring_billing_schedule'
              and rbs.id = audit_logs.entity_id
              and rbs.tenant_id = ${tenantId}
          )
          or exists (
            select 1
            from customer_notes cn
            where audit_logs.entity_type = 'customer_note'
              and cn.id = audit_logs.entity_id
              and cn.tenant_id = ${tenantId}
          )
          or exists (
            select 1
            from alerts a
            left join payments p
              on p.id = a.payment_id
              and p.tenant_id = ${tenantId}
            left join subscriptions s
              on s.id = a.subscription_id
              and s.tenant_id = ${tenantId}
            left join customers customer
              on customer.id = a.customer_id
              and customer.tenant_id = ${tenantId}
            left join customers fallback_customer
              on fallback_customer.id = coalesce(p.customer_id, s.customer_id)
              and fallback_customer.tenant_id = ${tenantId}
            where audit_logs.entity_type = 'alert'
              and a.id = audit_logs.entity_id
              and (
                coalesce(a.payload ->> 'tenantId', '') = ${tenantId}
                or
                customer.id is not null
                or fallback_customer.id is not null
                or p.id is not null
                or s.id is not null
              )
          )
          or exists (
            select 1
            from webhook_events w
            where audit_logs.entity_type = 'webhook_event'
              and w.id = audit_logs.entity_id
              and w.tenant_id = ${tenantId}
          )
          or exists (
            select 1
            from tenants t
            where audit_logs.entity_type = 'tenant_recurring_billing_cron'
              and t.id = audit_logs.entity_id
              and t.id = ${tenantId}
          )
        )
      order by created_at desc
      limit 8
    `);

  return result.rows;
});

export async function listRecentAuditActivity(options: {
  mode?: DashboardModeFilter;
  tenantId: string;
}) {
  return listRecentAuditActivityByMode(options.mode ?? "all", options.tenantId);
}
