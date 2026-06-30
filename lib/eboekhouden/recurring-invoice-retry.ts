import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";
import {
  isSafeInvoiceRetryFailure,
  SAFE_INVOICE_RETRY_FAILURE_CODES,
} from "@/lib/eboekhouden/invoice-failure-retry";
import { buildInvoiceRetryQueuedMetadata } from "@/lib/eboekhouden/invoice-retry-metadata";
import { filterSafeFailedInvoiceRetryIds } from "@/lib/eboekhouden/invoice-retry-candidates";
import { countSafeInvoiceRetryFailures } from "@/lib/eboekhouden/invoice-retry-summary";
import { buildRecurringFailedInvoiceFilter } from "@/lib/eboekhouden/recurring-invoice-query";

const DEFAULT_BATCH_SIZE = 25;

type RecurringInvoiceActor = {
  email?: string | null;
  kind: "system" | "user";
};

type FailedRecurringRetryBatchResult = {
  queuedCount: number;
  skippedCount: number;
};

type FailedRecurringInvoiceRetrySummary = {
  retryableCount: number;
  totalFailedCount: number;
};

async function resolveTenantId(tenantId?: string) {
  if (!tenantId) {
    throw new Error("Tenant id is required.");
  }

  return tenantId;
}

async function queueRetryForFailedRecurringInvoice(input: {
  actor: RecurringInvoiceActor;
  mode: "live" | "test";
  scheduleId: string;
  tenantId?: string;
}): Promise<"queued" | "skipped"> {
  const resolvedTenantId = await resolveTenantId(input.tenantId);
  const candidate = await getDb().execute<{
    errorMessage: string | null;
    scheduleId: string;
  }>(sql`
    select
      rbs.id as "scheduleId",
      (rbs.metadata ->> 'invoiceCreationError') as "errorMessage"
    from recurring_billing_schedules rbs
    where rbs.id = ${input.scheduleId}
      and ${buildRecurringFailedInvoiceFilter(input.mode, resolvedTenantId)}
    limit 1
  `);
  const row = candidate.rows[0];

  if (!row || !isSafeInvoiceRetryFailure(row.errorMessage)) {
    return "skipped";
  }

  const result = await getDb().execute<{ id: string }>(sql`
    update recurring_billing_schedules rbs
    set
      invoice_state = 'pending_invoice',
      invoice_failed_at = null,
      metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(
        buildInvoiceRetryQueuedMetadata({
          actorEmail: input.actor.email,
        }),
      )}::jsonb,
      updated_at = now()
    where rbs.id = ${input.scheduleId}
      and ${buildRecurringFailedInvoiceFilter(input.mode, resolvedTenantId)}
    returning id
  `);

  if (!result.rows[0]?.id) {
    return "skipped";
  }

  await writeAuditLog(
    {
      action: "recurring_invoice.retry_queue",
      details: {
        allowedFailureCodes: SAFE_INVOICE_RETRY_FAILURE_CODES,
        scheduleId: input.scheduleId,
      },
      entityId: input.scheduleId,
      entityType: "recurring_billing_schedule",
      mode: input.mode,
      outcome: "success",
      summary:
        "Queued a controlled retry for a failed recurring invoice after safe failure-code check.",
    },
    undefined,
    input.actor,
  );

  return "queued";
}

export async function getFailedRecurringInvoiceRetrySummary(
  mode: "live" | "test",
  tenantId?: string,
): Promise<FailedRecurringInvoiceRetrySummary> {
  const resolvedTenantId = await resolveTenantId(tenantId);
  const result = await getDb().execute<{
    errorMessage: string | null;
    scheduleId: string;
  }>(sql`
    select
      rbs.id as "scheduleId",
      (rbs.metadata ->> 'invoiceCreationError') as "errorMessage"
    from recurring_billing_schedules rbs
    where rbs.tenant_id = ${resolvedTenantId}
      and ${buildRecurringFailedInvoiceFilter(mode, resolvedTenantId)}
  `);

  return countSafeInvoiceRetryFailures(result.rows);
}

export async function queueRetryForFailedRecurringInvoicesBatch(input: {
  actor: RecurringInvoiceActor;
  mode: "live" | "test";
  scheduleIds: string[];
  tenantId?: string;
}): Promise<FailedRecurringRetryBatchResult> {
  let queuedCount = 0;
  let skippedCount = 0;

  for (const scheduleId of input.scheduleIds) {
    const status = await queueRetryForFailedRecurringInvoice({
      actor: input.actor,
      mode: input.mode,
      scheduleId,
      tenantId: input.tenantId,
    });

    if (status === "queued") {
      queuedCount += 1;
      continue;
    }

    skippedCount += 1;
  }

  return {
    queuedCount,
    skippedCount,
  };
}

export async function queueRetryForSafeFailedRecurringInvoicesBatch(input: {
  actor: RecurringInvoiceActor;
  limit?: number;
  mode: "live" | "test";
  tenantId?: string;
}) {
  const resolvedTenantId = await resolveTenantId(input.tenantId);
  const failedRows = await getDb().execute<{
    errorMessage: string | null;
    id: string;
  }>(sql`
    select
      rbs.id as id,
      (rbs.metadata ->> 'invoiceCreationError') as "errorMessage"
    from recurring_billing_schedules rbs
    where ${buildRecurringFailedInvoiceFilter(input.mode, resolvedTenantId)}
    order by rbs.updated_at asc, rbs.created_at asc
    limit ${Math.max(1, input.limit ?? DEFAULT_BATCH_SIZE)}
  `);
  const safeScheduleIds = filterSafeFailedInvoiceRetryIds(failedRows.rows);

  if (safeScheduleIds.length === 0) {
    return {
      queuedCount: 0,
      skippedCount: 0,
    };
  }

  return queueRetryForFailedRecurringInvoicesBatch({
    actor: input.actor,
    mode: input.mode,
    scheduleIds: safeScheduleIds,
    tenantId: resolvedTenantId,
  });
}
