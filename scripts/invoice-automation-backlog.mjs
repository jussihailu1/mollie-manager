#!/usr/bin/env node

import nextEnv from "@next/env";
import pg from "pg";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const mode = process.argv[2] === "live" ? "live" : "test";
const limit = Math.max(1, Math.min(200, Number(process.argv[3] ?? "50")));
const connectionString = process.env.DATABASE_URL;
const useSsl = process.env.DATABASE_SSL === "true";

if (!connectionString) {
  throw new Error("DATABASE_URL is required for invoice backlog report.");
}

const { Pool } = pg;
const pool = new Pool({
  connectionString,
  ssl: useSsl ? true : undefined,
});

try {
  const [
    failedFirstPaymentRows,
    failedRecurringRows,
    unsentFirstPaymentRows,
    unsentRecurringRows,
    heartbeatRows,
  ] = await Promise.all([
    pool.query(
      `
        select
          p.id as payment_id,
          p.invoice_state,
          p.invoice_failed_at,
          i.provider_invoice_id,
          coalesce(i.canonical_invoice_number, i.provider_invoice_number) as invoice_number,
          c.email as customer_email,
          (p.metadata ->> 'invoiceCreationError') as invoice_creation_error,
          (
            coalesce(p.metadata ->> 'invoiceCreationError', '') like '%FACT_014%'
            or coalesce(p.metadata ->> 'invoiceCreationError', '') like '%FACT_VERWERK_004%'
          ) as retry_safe
        from payments p
        left join invoices i on i.tenant_id = p.tenant_id and i.owner_type = 'payment' and i.owner_id = p.id
        left join customers c on c.id = p.customer_id and c.mode = p.mode
        where p.mode = $1
          and p.payment_type = 'first'
          and p.invoice_state = 'invoice_failed'
        order by p.updated_at desc
        limit $2
      `,
      [mode, limit],
    ),
    pool.query(
      `
        select
          rbs.id as schedule_id,
          rbs.invoice_state,
          rbs.invoice_failed_at,
          rbs.planned_collection_date::text as planned_collection_date,
          rbs.invoice_send_due_date::text as invoice_send_due_date,
          i.provider_invoice_id,
          coalesce(i.canonical_invoice_number, i.provider_invoice_number) as invoice_number,
          c.email as customer_email,
          (rbs.metadata ->> 'invoiceCreationError') as invoice_creation_error,
          (
            coalesce(rbs.metadata ->> 'invoiceCreationError', '') like '%FACT_014%'
            or coalesce(rbs.metadata ->> 'invoiceCreationError', '') like '%FACT_VERWERK_004%'
          ) as retry_safe
        from recurring_billing_schedules rbs
        left join invoices i on i.tenant_id = rbs.tenant_id and i.owner_type = 'recurring_schedule' and i.owner_id = rbs.id
        inner join subscriptions s on s.id = rbs.subscription_id
        inner join customers c on c.id = s.customer_id and c.mode = rbs.mode
        where rbs.mode = $1
          and rbs.invoice_state = 'invoice_failed'
        order by rbs.updated_at desc
        limit $2
      `,
      [mode, limit],
    ),
    pool.query(
      `
        select
          p.id as payment_id,
          p.invoice_created_at,
          i.provider_invoice_id,
          coalesce(i.canonical_invoice_number, i.provider_invoice_number) as invoice_number,
          c.email as customer_email,
          coalesce(p.metadata ->> 'invoiceDeliveryStatus', 'unknown') as invoice_delivery_status,
          coalesce(p.metadata ->> 'invoiceDeliveryError', null) as invoice_delivery_error,
          case
            when coalesce(p.metadata ->> 'invoiceDeliveryAttemptCount', '') ~ '^[0-9]+$'
            then (p.metadata ->> 'invoiceDeliveryAttemptCount')::int
            else 0
          end as invoice_delivery_attempt_count,
          coalesce(p.metadata ->> 'invoiceDeliveryNextRetryAt', null) as invoice_delivery_next_retry_at,
          case
            when lower(coalesce(p.metadata ->> 'invoiceDeliveryPermanentFailure', '')) in ('true', 'false')
            then (p.metadata ->> 'invoiceDeliveryPermanentFailure')::boolean
            else false
          end as invoice_delivery_permanent_failure
        from payments p
        left join invoices i on i.tenant_id = p.tenant_id and i.owner_type = 'payment' and i.owner_id = p.id
        left join customers c on c.id = p.customer_id and c.mode = p.mode
        where p.mode = $1
          and p.payment_type = 'first'
          and p.invoice_state = 'invoice_created'
          and p.invoice_sent_at is null
        order by p.invoice_created_at asc nulls last, p.created_at asc
        limit $2
      `,
      [mode, limit],
    ),
    pool.query(
      `
        select
          rbs.id as schedule_id,
          rbs.invoice_created_at,
          rbs.planned_collection_date::text as planned_collection_date,
          i.provider_invoice_id,
          coalesce(i.canonical_invoice_number, i.provider_invoice_number) as invoice_number,
          c.email as customer_email,
          coalesce(rbs.metadata ->> 'invoiceDeliveryStatus', 'unknown') as invoice_delivery_status,
          coalesce(rbs.metadata ->> 'invoiceDeliveryError', null) as invoice_delivery_error,
          case
            when coalesce(rbs.metadata ->> 'invoiceDeliveryAttemptCount', '') ~ '^[0-9]+$'
            then (rbs.metadata ->> 'invoiceDeliveryAttemptCount')::int
            else 0
          end as invoice_delivery_attempt_count,
          coalesce(rbs.metadata ->> 'invoiceDeliveryNextRetryAt', null) as invoice_delivery_next_retry_at,
          case
            when lower(coalesce(rbs.metadata ->> 'invoiceDeliveryPermanentFailure', '')) in ('true', 'false')
            then (rbs.metadata ->> 'invoiceDeliveryPermanentFailure')::boolean
            else false
          end as invoice_delivery_permanent_failure
        from recurring_billing_schedules rbs
        left join invoices i on i.tenant_id = rbs.tenant_id and i.owner_type = 'recurring_schedule' and i.owner_id = rbs.id
        inner join subscriptions s on s.id = rbs.subscription_id
        inner join customers c on c.id = s.customer_id and c.mode = rbs.mode
        where rbs.mode = $1
          and rbs.invoice_state = 'invoice_created'
          and rbs.invoice_sent_at is null
        order by rbs.invoice_created_at asc nulls last, rbs.created_at asc
        limit $2
      `,
      [mode, limit],
    ),
    pool.query(
      `
        select
          max(al.created_at) filter (
            where al.action = 'recurring_invoice.cron_batch_create'
          ) as last_cron_run_at,
          (
            select al2.outcome
            from audit_logs al2
            where al2.mode = $1
              and al2.action = 'recurring_invoice.cron_batch_create'
            order by al2.created_at desc
            limit 1
          ) as last_cron_run_outcome,
          max(al.created_at) filter (
            where al.action = 'recurring_invoice.cron_batch_create'
              and al.outcome = 'success'
          ) as last_cron_success_at,
          max(al.created_at) filter (
            where al.action = 'recurring_invoice.cron_batch_create'
              and al.outcome = 'failure'
          ) as last_cron_failure_at
        from audit_logs al
        where al.mode = $1
          and al.action = 'recurring_invoice.cron_batch_create'
      `,
      [mode],
    ),
  ]);

  const failedFirstPaymentSafeCount = failedFirstPaymentRows.rows.filter(
    (row) => row.retry_safe === true,
  ).length;
  const failedRecurringSafeCount = failedRecurringRows.rows.filter(
    (row) => row.retry_safe === true,
  ).length;
  const unsentFirstPaymentPermanentCount = unsentFirstPaymentRows.rows.filter(
    (row) => row.invoice_delivery_permanent_failure === true,
  ).length;
  const unsentRecurringPermanentCount = unsentRecurringRows.rows.filter(
    (row) => row.invoice_delivery_permanent_failure === true,
  ).length;

  const report = {
    heartbeat: heartbeatRows.rows[0] ?? null,
    mode,
    recommendedActions: [
      failedFirstPaymentSafeCount > 0 || failedRecurringSafeCount > 0
        ? "Queue safe failed retries from /settings or allow cron to re-queue automatically."
        : "No retry-safe failed rows found.",
      unsentFirstPaymentRows.rows.length > 0 || unsentRecurringRows.rows.length > 0
        ? "Run cron now or wait for next schedule to process unsent invoice emails."
        : "No unsent invoice-created rows found.",
      unsentFirstPaymentPermanentCount > 0 || unsentRecurringPermanentCount > 0
        ? "Permanent delivery failures exist; manual operator follow-up required."
        : "No permanent delivery failures in unsent queue.",
    ],
    summary: {
      failedFirstPaymentCount: failedFirstPaymentRows.rowCount,
      failedFirstPaymentRetrySafeCount: failedFirstPaymentSafeCount,
      failedRecurringCount: failedRecurringRows.rowCount,
      failedRecurringRetrySafeCount: failedRecurringSafeCount,
      unsentFirstPaymentCreatedCount: unsentFirstPaymentRows.rowCount,
      unsentFirstPaymentPermanentCount,
      unsentRecurringCreatedCount: unsentRecurringRows.rowCount,
      unsentRecurringPermanentCount,
    },
    tables: {
      failedFirstPaymentRows: failedFirstPaymentRows.rows,
      failedRecurringRows: failedRecurringRows.rows,
      unsentFirstPaymentRows: unsentFirstPaymentRows.rows,
      unsentRecurringRows: unsentRecurringRows.rows,
    },
    timestamp: new Date().toISOString(),
  };

  console.log(JSON.stringify(report, null, 2));
} finally {
  await pool.end();
}
