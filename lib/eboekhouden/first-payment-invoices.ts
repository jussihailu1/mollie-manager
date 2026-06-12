import "server-only";

import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import { billingSettingsAreComplete, getTenantBillingSettings } from "@/lib/billing-settings";
import { getDb } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import {
  isSafeInvoiceRetryFailure,
  SAFE_INVOICE_RETRY_FAILURE_CODES,
} from "@/lib/eboekhouden/invoice-failure-retry";
import { buildFirstPaymentInvoiceReference } from "@/lib/eboekhouden/invoice-reference";
import { type FirstPaymentInvoiceActor } from "@/lib/eboekhouden/first-payment-invoice-persistence";
import { buildFirstPaymentInvoiceDelivery } from "@/lib/eboekhouden/first-payment-invoice-delivery";
import {
  getDueFirstPaymentInvoiceQueueSummary as getDueFirstPaymentInvoiceQueueSummaryImpl,
  listDueFirstPaymentInvoiceCandidates as listDueFirstPaymentInvoiceCandidatesImpl,
  normalizeFirstPaymentInvoiceStates as normalizeFirstPaymentInvoiceStatesImpl,
} from "@/lib/eboekhouden/first-payment-invoice-queue";
import {
  listFailedFirstPaymentRecoveryCandidates,
  storeRecoveredFailedFirstPaymentSuccess,
} from "@/lib/eboekhouden/first-payment-invoice-recovery";
import { resolveFirstPaymentInvoiceDate } from "@/lib/eboekhouden/first-payment-invoice-date";
import { findExistingEboekhoudenInvoiceByReference } from "@/lib/eboekhouden/invoice-reconcile";
import { buildInvoiceRetryQueuedMetadata } from "@/lib/eboekhouden/invoice-retry-metadata";
import { filterSafeFailedInvoiceRetryIds } from "@/lib/eboekhouden/invoice-retry-candidates";
import { countSafeInvoiceRetryFailures } from "@/lib/eboekhouden/invoice-retry-summary";
import { createInvoiceBatchWithDependencies } from "@/lib/invoice-creation-batch";
import { deliverCustomerInvoiceEmail } from "@/lib/invoice-delivery";
import { createEboekhoudenInvoiceForFirstPayment } from "@/lib/eboekhouden/first-payment-invoice-workflow";

export { createEboekhoudenInvoiceForFirstPayment };

export {
  getDueFirstPaymentInvoiceQueueSummaryImpl as getDueFirstPaymentInvoiceQueueSummary,
  listDueFirstPaymentInvoiceCandidatesImpl as listDueFirstPaymentInvoiceCandidates,
  normalizeFirstPaymentInvoiceStatesImpl as normalizeFirstPaymentInvoiceStates,
};

const DEFAULT_BATCH_SIZE = 25;

type InvoiceActor = FirstPaymentInvoiceActor;

type FirstPaymentInvoiceBatchResult = {
  actionableCount: number;
  createdCount: number;
  failedCount: number;
  remainingActionableCount: number;
  skippedCount: number;
};

type FailedFirstPaymentRecoveryBatchResult = {
  ambiguousCount: number;
  recoveredCount: number;
  scannedCount: number;
};

type FailedFirstPaymentRetryBatchResult = {
  queuedCount: number;
  skippedCount: number;
};

type FailedFirstPaymentInvoiceRetrySummary = {
  retryableCount: number;
  totalFailedCount: number;
};

export async function queueRetryForSafeFailedFirstPaymentInvoicesBatch(input: {
  actor: InvoiceActor;
  limit?: number;
  mode: MollieMode;
}): Promise<FailedFirstPaymentRetryBatchResult> {
  const failedRows = await getDb().execute<{
    errorMessage: string | null;
    id: string;
  }>(sql`
    select
      p.id as id,
      (p.metadata ->> 'invoiceCreationError') as "errorMessage"
    from payments p
    where p.mode = ${input.mode}
      and p.payment_type = 'first'
      and p.invoice_state = 'invoice_failed'
      and p.eboekhouden_invoice_id is null
      and p.eboekhouden_invoice_number is null
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
      and mode = ${input.mode}
      and payment_type = 'first'
      and invoice_state = 'invoice_failed'
      and eboekhouden_invoice_id is null
      and eboekhouden_invoice_number is null
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
): Promise<FailedFirstPaymentInvoiceRetrySummary> {
  const result = await getDb().execute<{
    errorMessage: string | null;
    paymentId: string;
  }>(sql`
    select
      p.id as "paymentId",
      (p.metadata ->> 'invoiceCreationError') as "errorMessage"
    from payments p
    where p.mode = ${mode}
      and p.payment_type = 'first'
      and p.invoice_state = 'invoice_failed'
      and p.eboekhouden_invoice_id is null
      and p.eboekhouden_invoice_number is null
  `);

  return countSafeInvoiceRetryFailures(result.rows);
}

export async function queueRetryForFailedFirstPaymentInvoicesBatch(input: {
  actor: InvoiceActor;
  mode: MollieMode;
  paymentIds: string[];
}): Promise<FailedFirstPaymentRetryBatchResult> {
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
        and p.mode = ${input.mode}
        and p.payment_type = 'first'
        and p.invoice_state = 'invoice_failed'
        and p.eboekhouden_invoice_id is null
        and p.eboekhouden_invoice_number is null
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
        and mode = ${input.mode}
        and payment_type = 'first'
        and invoice_state = 'invoice_failed'
        and eboekhouden_invoice_id is null
        and eboekhouden_invoice_number is null
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

export async function createDueFirstPaymentInvoicesBatch(input: {
  actor: InvoiceActor;
  limit?: number;
  mode: MollieMode;
}): Promise<FirstPaymentInvoiceBatchResult> {
  const settings = await getTenantBillingSettings();

  if (!billingSettingsAreComplete(settings)) {
    throw new Error(
      "Tenant billing settings are incomplete. Select an invoice template and revenue ledger first.",
    );
  }

  await normalizeFirstPaymentInvoiceStatesImpl({
    mode: input.mode,
  });

  return createInvoiceBatchWithDependencies(input, {
    createInvoice: async (entityId) =>
      createEboekhoudenInvoiceForFirstPayment(entityId, {
        actor: input.actor,
        settings,
      }),
    getRemainingSummary: getDueFirstPaymentInvoiceQueueSummaryImpl,
    loadCandidates: async (mode, limit) =>
      (await listDueFirstPaymentInvoiceCandidatesImpl(mode, limit)).map((row) => ({
        entityId: row.paymentId,
      })),
  });
}

export async function recoverFailedFirstPaymentInvoicesBatch(input: {
  actor: InvoiceActor;
  limit?: number;
  mode: MollieMode;
}): Promise<FailedFirstPaymentRecoveryBatchResult> {
  const candidates = await listFailedFirstPaymentRecoveryCandidates(
    input.mode,
    input.limit ?? DEFAULT_BATCH_SIZE,
  );
  let recoveredCount = 0;
  let ambiguousCount = 0;

  for (const candidate of candidates) {
    const invoiceDate = resolveFirstPaymentInvoiceDate({
      paidAt: candidate.paidAt,
      paymentCreatedAt: candidate.paymentCreatedAt,
    });
    if (!invoiceDate) {
      continue;
    }

    const reference = buildFirstPaymentInvoiceReference({
      invoiceDate,
      paymentId: candidate.paymentId,
    });
    const existing = await findExistingEboekhoudenInvoiceByReference({
      date: invoiceDate,
      reference,
      relationId: candidate.eboekhoudenRelationId,
    });

    if (existing.status === "ambiguous") {
      ambiguousCount += 1;
      continue;
    }

    if (existing.status !== "found") {
      continue;
    }

    const recovered = await storeRecoveredFailedFirstPaymentSuccess({
      actor: input.actor,
      candidate,
      invoice: existing.invoice,
    });
    if (!recovered) {
      continue;
    }

    recoveredCount += 1;
    await deliverCustomerInvoiceEmail(
      buildFirstPaymentInvoiceDelivery({
        actor: input.actor,
        customerEmail: candidate.customerEmail,
        customerId: candidate.customerId,
        eboekhoudenInvoiceId: recovered.invoiceId,
        eboekhoudenInvoiceNumber: recovered.invoiceNumber,
        eboekhoudenInvoicePdfUrl: existing.invoice.urlPdfFile ?? null,
        entityId: candidate.paymentId,
        mode: candidate.mode,
        subscriptionId: candidate.subscriptionId,
      }),
    );
  }

  return {
    ambiguousCount,
    recoveredCount,
    scannedCount: candidates.length,
  };
}
