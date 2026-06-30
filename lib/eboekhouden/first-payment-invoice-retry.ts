import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import {
  isSafeInvoiceRetryFailure,
  SAFE_INVOICE_RETRY_FAILURE_CODES,
} from "@/lib/eboekhouden/invoice-failure-retry";
import { type FirstPaymentInvoiceActor } from "@/lib/eboekhouden/first-payment-invoice-persistence";
import { buildInvoiceRetryQueuedMetadata } from "@/lib/eboekhouden/invoice-retry-metadata";
import { filterSafeFailedInvoiceRetryIds } from "@/lib/eboekhouden/invoice-retry-candidates";
import { countSafeInvoiceRetryFailures } from "@/lib/eboekhouden/invoice-retry-summary";

const DEFAULT_BATCH_SIZE = 25;

type FailedFirstPaymentRetryBatchResult = {
  queuedCount: number;
  skippedCount: number;
};

type FailedFirstPaymentInvoiceRetrySummary = {
  retryableCount: number;
  totalFailedCount: number;
};

async function resolveTenantId(tenantId?: string) {
  if (!tenantId) {
    throw new Error("Tenant id is required.");
  }

  return tenantId;
}

function buildFailedFirstPaymentRetryFilter(mode: MollieMode, tenantId?: string) {
  return sql`
    p.mode = ${mode}
    and p.tenant_id = ${tenantId}
    and p.payment_type = 'first'
    and p.invoice_state = 'invoice_failed'
    and p.eboekhouden_invoice_id is null
    and p.eboekhouden_invoice_number is null
  `;
}

export async function queueRetryForSafeFailedFirstPaymentInvoicesBatch(input: {
  actor: FirstPaymentInvoiceActor;
  limit?: number;
  mode: MollieMode;
  tenantId?: string;
}): Promise<FailedFirstPaymentRetryBatchResult> {
  const resolvedTenantId = await resolveTenantId(input.tenantId);
  const failedRows = await getDb().execute<{
    errorMessage: string | null;
    id: string;
  }>(sql`
    select
      p.id as id,
      (p.metadata ->> 'invoiceCreationError') as "errorMessage"
    from payments p
    where ${buildFailedFirstPaymentRetryFilter(input.mode, resolvedTenantId)}
    order by p.updated_at asc, p.created_at asc
    limit ${Math.max(1, input.limit ?? DEFAULT_BATCH_SIZE)}
  `);
  const safePaymentIds = filterSafeFailedInvoiceRetryIds(failedRows.rows);

  if (safePaymentIds.length === 0) {
    return {
      queuedCount: 0,
      skippedCount: 0,
    };
  }

  const result = await getDb().execute<{ id: string }>(sql`
    update payments
    set
      invoice_state = 'pending_invoice',
      invoice_failed_at = null,
      metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(
        buildInvoiceRetryQueuedMetadata({
          actorEmail: input.actor.email,
          includeAllowedFailureCodes: true,
        }),
      )}::jsonb,
      updated_at = now()
    where id = any(${safePaymentIds}::text[])
      and ${buildFailedFirstPaymentRetryFilter(input.mode, resolvedTenantId)}
    returning id
  `);

  const queuedCount = result.rows.length;
  const skippedCount = safePaymentIds.length - queuedCount;

  if (queuedCount > 0) {
    await writeAuditLog(
      {
        action: "first_payment_invoice.retry_queue_batch",
        details: {
          allowedFailureCodes: SAFE_INVOICE_RETRY_FAILURE_CODES,
          mode: input.mode,
          queuedCount,
          skippedCount,
        },
        entityId: input.mode,
        entityType: "first_payment_invoice_retry_batch",
        mode: input.mode,
        outcome: "success",
        summary:
          "Queued safe failed first-payment invoices back to pending for automatic retry.",
      },
      undefined,
      input.actor,
    );
  }

  return {
    queuedCount,
    skippedCount,
  };
}

export async function getFailedFirstPaymentInvoiceRetrySummary(
  mode: MollieMode,
  tenantId?: string,
): Promise<FailedFirstPaymentInvoiceRetrySummary> {
  const resolvedTenantId = await resolveTenantId(tenantId);
  const result = await getDb().execute<{
    errorMessage: string | null;
    paymentId: string;
  }>(sql`
    select
      p.id as "paymentId",
      (p.metadata ->> 'invoiceCreationError') as "errorMessage"
    from payments p
    where p.tenant_id = ${resolvedTenantId}
      and ${buildFailedFirstPaymentRetryFilter(mode, resolvedTenantId)}
  `);

  return countSafeInvoiceRetryFailures(result.rows);
}

export async function queueRetryForFailedFirstPaymentInvoicesBatch(input: {
  actor: FirstPaymentInvoiceActor;
  mode: MollieMode;
  paymentIds: string[];
  tenantId?: string;
}): Promise<FailedFirstPaymentRetryBatchResult> {
  const resolvedTenantId = await resolveTenantId(input.tenantId);
  let queuedCount = 0;
  let skippedCount = 0;

  for (const paymentId of input.paymentIds) {
    const row = await getDb().execute<{
      errorMessage: string | null;
      id: string;
    }>(sql`
      select
        p.id,
        (p.metadata ->> 'invoiceCreationError') as "errorMessage"
      from payments p
      where p.id = ${paymentId}
        and ${buildFailedFirstPaymentRetryFilter(input.mode, resolvedTenantId)}
      limit 1
    `);
    const candidate = row.rows[0];

    if (!candidate || !isSafeInvoiceRetryFailure(candidate.errorMessage)) {
      skippedCount += 1;
      continue;
    }

    const updated = await getDb().execute<{ id: string }>(sql`
      update payments
      set
        invoice_state = 'pending_invoice',
        invoice_failed_at = null,
        metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(
          buildInvoiceRetryQueuedMetadata({
            actorEmail: input.actor.email,
            includeAllowedFailureCodes: true,
          }),
      )}::jsonb,
      updated_at = now()
    where id = ${paymentId}
      and ${buildFailedFirstPaymentRetryFilter(input.mode, resolvedTenantId)}
      returning id
    `);

    if (!updated.rows[0]?.id) {
      skippedCount += 1;
      continue;
    }

    queuedCount += 1;
  }

  if (queuedCount > 0) {
    await writeAuditLog(
      {
        action: "first_payment_invoice.retry_queue_batch",
        details: {
          allowedFailureCodes: SAFE_INVOICE_RETRY_FAILURE_CODES,
          mode: input.mode,
          queuedCount,
          requestedCount: input.paymentIds.length,
          skippedCount,
        },
        entityId: input.mode,
        entityType: "first_payment_invoice_retry_batch",
        mode: input.mode,
        outcome: "success",
        summary:
          "Processed controlled retry queue request for failed first-payment invoices.",
      },
      undefined,
      input.actor,
    );
  }

  return {
    queuedCount,
    skippedCount,
  };
}
