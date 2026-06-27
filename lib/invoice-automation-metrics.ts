import "server-only";

import { sql } from "drizzle-orm";

import type { MollieMode } from "@/lib/env";
import { getDb } from "@/lib/db";
import { getSingleTenantIdOrThrow } from "@/lib/tenants";

export type InvoiceAutomationSnapshot = {
  dueFirstPaymentPendingCount: number;
  dueRecurringPendingCount: number;
  failedFirstPaymentCount: number;
  failedFirstPaymentRecoverableCount: number;
  failedRecurringCount: number;
  failedRecurringRecoverableCount: number;
};

export type InvoiceAutomationCronHeartbeat = {
  lastCronFailureAt: string | null;
  lastCronRunAt: string | null;
  lastCronRunOutcome: "failure" | "success" | null;
  lastCronSuccessAt: string | null;
};

function toCount(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return Number(value);
  }

  return 0;
}

async function resolveTenantId(tenantId?: string) {
  return tenantId ?? (await getSingleTenantIdOrThrow());
}

export async function getInvoiceAutomationSnapshot(
  mode: MollieMode,
  tenantId?: string,
) {
  const resolvedTenantId = await resolveTenantId(tenantId);
  const result = await getDb().execute<{
    dueFirstPaymentPendingCount: number | string;
    dueRecurringPendingCount: number | string;
    failedFirstPaymentCount: number | string;
    failedFirstPaymentRecoverableCount: number | string;
    failedRecurringCount: number | string;
    failedRecurringRecoverableCount: number | string;
  }>(sql`
    with first_payment_rows as (
      select
        p.id,
        p.invoice_state,
        (p.metadata ->> 'invoiceCreationError') as invoice_error
      from payments p
      where p.mode = ${mode}
        and p.tenant_id = ${resolvedTenantId}
        and p.payment_type = 'first'
    ),
    recurring_rows as (
      select
        rbs.id,
        rbs.invoice_state,
        rbs.invoice_send_due_date,
        (rbs.metadata ->> 'invoiceCreationError') as invoice_error
      from recurring_billing_schedules rbs
      where rbs.mode = ${mode}
        and rbs.tenant_id = ${resolvedTenantId}
    )
    select
      (select count(*) from first_payment_rows where invoice_state = 'pending_invoice') as "dueFirstPaymentPendingCount",
      (select count(*) from recurring_rows where invoice_state = 'pending_invoice' and invoice_send_due_date <= current_date) as "dueRecurringPendingCount",
      (select count(*) from first_payment_rows where invoice_state = 'invoice_failed') as "failedFirstPaymentCount",
      (
        select count(*)
        from first_payment_rows
        where invoice_state = 'invoice_failed'
          and (
            coalesce(invoice_error, '') like '%FACT_014%'
            or coalesce(invoice_error, '') like '%FACT_VERWERK_004%'
          )
      ) as "failedFirstPaymentRecoverableCount",
      (select count(*) from recurring_rows where invoice_state = 'invoice_failed') as "failedRecurringCount",
      (
        select count(*)
        from recurring_rows
        where invoice_state = 'invoice_failed'
          and (
            coalesce(invoice_error, '') like '%FACT_014%'
            or coalesce(invoice_error, '') like '%FACT_VERWERK_004%'
          )
      ) as "failedRecurringRecoverableCount"
  `);
  const row = result.rows[0];

  return {
    dueFirstPaymentPendingCount: toCount(row?.dueFirstPaymentPendingCount),
    dueRecurringPendingCount: toCount(row?.dueRecurringPendingCount),
    failedFirstPaymentCount: toCount(row?.failedFirstPaymentCount),
    failedFirstPaymentRecoverableCount: toCount(
      row?.failedFirstPaymentRecoverableCount,
    ),
    failedRecurringCount: toCount(row?.failedRecurringCount),
    failedRecurringRecoverableCount: toCount(
      row?.failedRecurringRecoverableCount,
    ),
  } satisfies InvoiceAutomationSnapshot;
}

export async function getInvoiceAutomationCronHeartbeat(
  mode: MollieMode,
  tenantId?: string,
): Promise<InvoiceAutomationCronHeartbeat> {
  const resolvedTenantId = await resolveTenantId(tenantId);
  const result = await getDb().execute<{
    lastCronFailureAt: string | null;
    lastCronRunAt: string | null;
    lastCronRunOutcome: "failure" | "success" | null;
    lastCronSuccessAt: string | null;
  }>(sql`
    select
      max(al.created_at) filter (
        where al.action = 'recurring_invoice.cron_batch_create'
      ) as "lastCronRunAt",
      max(al.created_at) filter (
        where al.action = 'recurring_invoice.cron_batch_create'
          and al.outcome = 'success'
      ) as "lastCronSuccessAt",
      max(al.created_at) filter (
        where al.action = 'recurring_invoice.cron_batch_create'
          and al.outcome = 'failure'
      ) as "lastCronFailureAt",
      (
      select al2.outcome
      from audit_logs al2
      where al2.mode = ${mode}
        and (
          exists (
            select 1
            from payments p
            where al2.entity_type = 'payment'
              and p.id = al2.entity_id
              and p.tenant_id = ${resolvedTenantId}
          )
          or exists (
            select 1
            from recurring_billing_schedules rbs
            where al2.entity_type = 'recurring_billing_schedule'
              and rbs.id = al2.entity_id
              and rbs.tenant_id = ${resolvedTenantId}
          )
        )
          and al2.action = 'recurring_invoice.cron_batch_create'
        order by al2.created_at desc
        limit 1
      ) as "lastCronRunOutcome"
    from audit_logs al
    where al.mode = ${mode}
      and (
        exists (
          select 1
          from payments p
          where al.entity_type = 'payment'
            and p.id = al.entity_id
            and p.tenant_id = ${resolvedTenantId}
        )
        or exists (
          select 1
          from recurring_billing_schedules rbs
          where al.entity_type = 'recurring_billing_schedule'
            and rbs.id = al.entity_id
            and rbs.tenant_id = ${resolvedTenantId}
        )
      )
      and al.action = 'recurring_invoice.cron_batch_create'
  `);
  const row = result.rows[0];

  return {
    lastCronFailureAt: row?.lastCronFailureAt ?? null,
    lastCronRunAt: row?.lastCronRunAt ?? null,
    lastCronRunOutcome: row?.lastCronRunOutcome ?? null,
    lastCronSuccessAt: row?.lastCronSuccessAt ?? null,
  };
}
