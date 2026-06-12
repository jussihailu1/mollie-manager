import "server-only";

import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import {
  billingSettingsAreComplete,
  getTenantBillingSettings,
  type TenantBillingSettings,
} from "@/lib/billing-settings";
import { getDb } from "@/lib/db";
import { createEboekhoudenInvoice } from "@/lib/eboekhouden/client";
import {
  isSafeInvoiceRetryFailure,
  SAFE_INVOICE_RETRY_FAILURE_CODES,
} from "@/lib/eboekhouden/invoice-failure-retry";
import {
  isEboekhoudenReferenceAlreadyExistsError,
  toInvoiceAmountNumber,
  toInvoiceCount,
} from "@/lib/eboekhouden/invoice-flow-helpers";
import { buildRecurringInvoiceReference } from "@/lib/eboekhouden/invoice-reference";
import { findExistingEboekhoudenInvoiceByReference } from "@/lib/eboekhouden/invoice-reconcile";
import { buildInvoiceRetryQueuedMetadata } from "@/lib/eboekhouden/invoice-retry-metadata";
import {
  buildRecurringDueInvoiceFilter,
  buildRecurringFailedInvoiceFilter,
} from "@/lib/eboekhouden/recurring-invoice-query";
import {
  getScheduledInvoiceCandidate,
  type ScheduledInvoiceCandidate,
} from "@/lib/eboekhouden/recurring-invoice-candidate";
import { filterSafeFailedInvoiceRetryIds } from "@/lib/eboekhouden/invoice-retry-candidates";
import { countSafeInvoiceRetryFailures } from "@/lib/eboekhouden/invoice-retry-summary";
import {
  claimScheduleForInvoice,
  storeRecurringInvoiceCreationFailure,
  storeRecurringInvoiceCreationSuccess,
} from "@/lib/eboekhouden/recurring-invoice-persistence";
import {
  listFailedRecurringRecoveryCandidates,
  storeRecoveredFailedInvoiceSuccess,
} from "@/lib/eboekhouden/recurring-invoice-recovery";
import { createInvoiceBatchWithDependencies } from "@/lib/invoice-creation-batch";
import { deliverCustomerInvoiceEmail } from "@/lib/invoice-delivery";

const DEFAULT_BATCH_SIZE = 25;
type InvoiceActor = {
  email?: string | null;
  kind: "system" | "user";
};

type DueRecurringInvoiceQueueSummary = {
  actionableCount: number;
  blockedCount: number;
  dueCount: number;
};

type FailedRecurringInvoiceRetrySummary = {
  retryableCount: number;
  totalFailedCount: number;
};

type RecurringInvoiceBatchResult = {
  actionableCount: number;
  createdCount: number;
  failedCount: number;
  remainingActionableCount: number;
  skippedCount: number;
};

type FailedRecurringRetryBatchResult = {
  queuedCount: number;
  skippedCount: number;
};

type FailedRecurringRecoveryBatchResult = {
  ambiguousCount: number;
  recoveredCount: number;
  scannedCount: number;
};

type CreateScheduleInvoiceResult =
  | {
      invoiceId: string | null;
      invoiceNumber: string | null;
      scheduleId: string;
      status: "created";
    }
  | {
      reason: string;
      scheduleId: string;
      status: "failed" | "skipped";
    };

function daysBetween(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  return Math.max(Math.round((end - start) / 86_400_000), 0);
}

function buildReference(candidate: ScheduledInvoiceCandidate) {
  return buildRecurringInvoiceReference({
    plannedCollectionDate: candidate.plannedCollectionDate,
    scheduleId: candidate.scheduleId,
  });
}

async function listDueRecurringInvoiceCandidates(
  mode: "live" | "test",
  limit = DEFAULT_BATCH_SIZE,
) {
  const result = await getDb().execute<ScheduledInvoiceCandidate>(sql`
    select
      rbs.id as "scheduleId",
      rbs.subscription_id as "subscriptionId",
      rbs.mode,
      rbs.invoice_send_due_date::text as "invoiceSendDueDate",
      rbs.planned_collection_date::text as "plannedCollectionDate",
      rbs.amount_value::text as "amountValue",
      s.customer_id as "customerId",
      s.description as "subscriptionDescription",
      c.email as "customerEmail",
      c.eboekhouden_relation_id as "eboekhoudenRelationId"
    from recurring_billing_schedules rbs
    inner join subscriptions s on s.id = rbs.subscription_id
    inner join customers c on c.id = s.customer_id
    where ${buildRecurringDueInvoiceFilter(mode)}
      and c.eboekhouden_relation_id is not null
    order by rbs.invoice_send_due_date asc, rbs.planned_collection_date asc, rbs.created_at asc
    limit ${Math.max(1, limit)}
  `);

  return result.rows;
}

export async function getDueRecurringInvoiceQueueSummary(
  mode: "live" | "test",
): Promise<DueRecurringInvoiceQueueSummary> {
  const result = await getDb().execute<{
    actionableCount: number | string;
    blockedCount: number | string;
    dueCount: number | string;
  }>(sql`
    select
    count(*) filter (where c.eboekhouden_relation_id is not null) as "actionableCount",
      count(*) filter (where c.eboekhouden_relation_id is null) as "blockedCount",
      count(*) as "dueCount"
    from recurring_billing_schedules rbs
    inner join subscriptions s on s.id = rbs.subscription_id
    inner join customers c on c.id = s.customer_id
    where ${buildRecurringDueInvoiceFilter(mode)}
  `);
  const row = result.rows[0];

  return {
    actionableCount: toInvoiceCount(row?.actionableCount),
    blockedCount: toInvoiceCount(row?.blockedCount),
    dueCount: toInvoiceCount(row?.dueCount),
  };
}

export async function getFailedRecurringInvoiceRetrySummary(
  mode: "live" | "test",
): Promise<FailedRecurringInvoiceRetrySummary> {
  const result = await getDb().execute<{
    errorMessage: string | null;
    scheduleId: string;
  }>(sql`
    select
      rbs.id as "scheduleId",
      (rbs.metadata ->> 'invoiceCreationError') as "errorMessage"
    from recurring_billing_schedules rbs
    where ${buildRecurringFailedInvoiceFilter(mode)}
  `);

  return countSafeInvoiceRetryFailures(result.rows);
}

export async function queueRetryForFailedRecurringInvoice(input: {
  actor: InvoiceActor;
  mode: "live" | "test";
  scheduleId: string;
}): Promise<"queued" | "skipped"> {
  const candidate = await getDb().execute<{
    errorMessage: string | null;
    scheduleId: string;
  }>(sql`
    select
      rbs.id as "scheduleId",
      (rbs.metadata ->> 'invoiceCreationError') as "errorMessage"
    from recurring_billing_schedules rbs
    where rbs.id = ${input.scheduleId}
      and ${buildRecurringFailedInvoiceFilter(input.mode)}
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
      and ${buildRecurringFailedInvoiceFilter(input.mode)}
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

export async function queueRetryForFailedRecurringInvoicesBatch(input: {
  actor: InvoiceActor;
  mode: "live" | "test";
  scheduleIds: string[];
}): Promise<FailedRecurringRetryBatchResult> {
  let queuedCount = 0;
  let skippedCount = 0;

  for (const scheduleId of input.scheduleIds) {
    const status = await queueRetryForFailedRecurringInvoice({
      actor: input.actor,
      mode: input.mode,
      scheduleId,
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
  actor: InvoiceActor;
  limit?: number;
  mode: "live" | "test";
}) {
  const failedRows = await getDb().execute<{
    errorMessage: string | null;
    id: string;
  }>(sql`
    select
      rbs.id as id,
      (rbs.metadata ->> 'invoiceCreationError') as "errorMessage"
    from recurring_billing_schedules rbs
    where ${buildRecurringFailedInvoiceFilter(input.mode)}
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
  });
}

export async function recoverFailedRecurringInvoicesBatch(input: {
  actor: InvoiceActor;
  limit?: number;
  mode: "live" | "test";
}): Promise<FailedRecurringRecoveryBatchResult> {
  const candidates = await listFailedRecurringRecoveryCandidates(
    input.mode,
    input.limit ?? DEFAULT_BATCH_SIZE,
  );
  let recoveredCount = 0;
  let ambiguousCount = 0;

  for (const candidate of candidates) {
    const reference = buildRecurringInvoiceReference({
      plannedCollectionDate: candidate.plannedCollectionDate,
      scheduleId: candidate.scheduleId,
    });
    const existing = await findExistingEboekhoudenInvoiceByReference({
      date: candidate.invoiceSendDueDate,
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

    const recovered = await storeRecoveredFailedInvoiceSuccess({
      actor: input.actor,
      candidate,
      invoice: existing.invoice,
    });

    if (!recovered) {
      continue;
    }

    recoveredCount += 1;
    await deliverCustomerInvoiceEmail({
      actor: input.actor,
      customerEmail: candidate.customerEmail,
      customerId: candidate.customerId,
      eboekhoudenInvoiceId: recovered.invoiceId,
      eboekhoudenInvoiceNumber: recovered.invoiceNumber,
      eboekhoudenInvoicePdfUrl: existing.invoice.urlPdfFile ?? null,
      entityId: candidate.scheduleId,
      invoiceType: "recurring",
      mode: candidate.mode,
      plannedCollectionDate: candidate.plannedCollectionDate,
      subscriptionId: candidate.subscriptionId,
    });
  }

  return {
    ambiguousCount,
    recoveredCount,
    scannedCount: candidates.length,
  };
}

export async function createEboekhoudenInvoiceForSchedule(
  scheduleId: string,
  options?: {
    actor?: InvoiceActor;
    settings?: TenantBillingSettings | null;
  },
): Promise<CreateScheduleInvoiceResult> {
  const actor = options?.actor ?? {
    kind: "system",
  };
  const [settings, candidate] = await Promise.all([
    options?.settings ? Promise.resolve(options.settings) : getTenantBillingSettings(),
    getScheduledInvoiceCandidate(scheduleId),
  ]);

  if (!billingSettingsAreComplete(settings)) {
    throw new Error(
      "Tenant billing settings are incomplete. Select an invoice template and revenue ledger first.",
    );
  }

  if (!candidate) {
    throw new Error("Recurring billing schedule was not found.");
  }

  if (!candidate.eboekhoudenRelationId) {
    return {
      reason:
        "Customer is not linked to an e-Boekhouden relation. Link the customer before creating the invoice.",
      scheduleId,
      status: "skipped",
    };
  }

  const claimedScheduleId = await claimScheduleForInvoice({
    actor,
    mode: candidate.mode,
    scheduleId,
  });

  if (!claimedScheduleId) {
    return {
      reason: "Schedule row was already claimed or already invoiced.",
      scheduleId,
      status: "skipped",
    };
  }

  const reference = buildReference(candidate);

  try {
    const existing = await findExistingEboekhoudenInvoiceByReference({
      date: candidate.invoiceSendDueDate,
      reference,
      relationId: candidate.eboekhoudenRelationId,
    });

    if (existing.status === "ambiguous") {
      throw new Error(
        `Ambiguous e-Boekhouden invoice match for reference ${reference}; manual review required.`,
      );
    }

    if (existing.status === "found") {
      const storedRecoveredInvoice = await storeRecurringInvoiceCreationSuccess({
        actor,
        candidate,
        invoice: existing.invoice,
        source: "reconciled_existing",
      });
      await deliverCustomerInvoiceEmail({
        actor,
        customerEmail: candidate.customerEmail,
        customerId: candidate.customerId,
        eboekhoudenInvoiceId: storedRecoveredInvoice.invoiceId,
        eboekhoudenInvoiceNumber: storedRecoveredInvoice.invoiceNumber,
        eboekhoudenInvoicePdfUrl: existing.invoice.urlPdfFile ?? null,
        entityId: candidate.scheduleId,
        invoiceType: "recurring",
        mode: candidate.mode,
        plannedCollectionDate: candidate.plannedCollectionDate,
        subscriptionId: candidate.subscriptionId,
      });

      return {
        invoiceId: storedRecoveredInvoice.invoiceId,
        invoiceNumber: storedRecoveredInvoice.invoiceNumber,
        scheduleId,
        status: "created",
      };
    }

    const invoice = await createEboekhoudenInvoice({
      date: candidate.invoiceSendDueDate,
      inExVat: "EX",
      items: [
        {
          description: candidate.subscriptionDescription,
          ledgerId: settings!.revenueLedgerId!,
          pricePerUnit: toInvoiceAmountNumber(candidate.amountValue),
          quantity: 1,
          vatCode: settings!.vatCode,
        },
      ],
      print: false,
      reference,
      relationId: candidate.eboekhoudenRelationId,
      templateId: settings!.invoiceTemplateId!,
      termOfPayment: daysBetween(
        candidate.invoiceSendDueDate,
        candidate.plannedCollectionDate,
      ),
    });
    const storedInvoice = await storeRecurringInvoiceCreationSuccess({
      actor,
      candidate,
      invoice,
    });
    await deliverCustomerInvoiceEmail({
      actor,
      customerEmail: candidate.customerEmail,
      customerId: candidate.customerId,
      eboekhoudenInvoiceId: storedInvoice.invoiceId,
      eboekhoudenInvoiceNumber: storedInvoice.invoiceNumber,
      eboekhoudenInvoicePdfUrl: invoice.urlPdfFile ?? null,
      entityId: candidate.scheduleId,
      invoiceType: "recurring",
      mode: candidate.mode,
      plannedCollectionDate: candidate.plannedCollectionDate,
      subscriptionId: candidate.subscriptionId,
    });

    return {
      invoiceId: storedInvoice.invoiceId,
      invoiceNumber: storedInvoice.invoiceNumber,
      scheduleId,
      status: "created",
    };
  } catch (error) {
    if (isEboekhoudenReferenceAlreadyExistsError(error)) {
      const existing = await findExistingEboekhoudenInvoiceByReference({
        date: candidate.invoiceSendDueDate,
        reference,
        relationId: candidate.eboekhoudenRelationId,
      });

      if (existing.status === "found") {
        const storedRecoveredInvoice = await storeRecurringInvoiceCreationSuccess({
          actor,
          candidate,
          invoice: existing.invoice,
          source: "reconciled_existing",
        });
        await deliverCustomerInvoiceEmail({
          actor,
          customerEmail: candidate.customerEmail,
          customerId: candidate.customerId,
          eboekhoudenInvoiceId: storedRecoveredInvoice.invoiceId,
          eboekhoudenInvoiceNumber: storedRecoveredInvoice.invoiceNumber,
          eboekhoudenInvoicePdfUrl: existing.invoice.urlPdfFile ?? null,
          entityId: candidate.scheduleId,
          invoiceType: "recurring",
          mode: candidate.mode,
          plannedCollectionDate: candidate.plannedCollectionDate,
          subscriptionId: candidate.subscriptionId,
        });

        return {
          invoiceId: storedRecoveredInvoice.invoiceId,
          invoiceNumber: storedRecoveredInvoice.invoiceNumber,
          scheduleId,
          status: "created",
        };
      }
    }

    const errorMessage = await storeRecurringInvoiceCreationFailure({
      actor,
      candidate,
      error,
    });

    return {
      reason: errorMessage,
      scheduleId,
      status: "failed",
    };
  }
}

export async function createDueRecurringInvoicesBatch(input: {
  actor: InvoiceActor;
  limit?: number;
  mode: "live" | "test";
}): Promise<RecurringInvoiceBatchResult> {
  const settings = await getTenantBillingSettings();

  if (!billingSettingsAreComplete(settings)) {
    throw new Error(
      "Tenant billing settings are incomplete. Select an invoice template and revenue ledger first.",
    );
  }

  return createInvoiceBatchWithDependencies(input, {
    createInvoice: async (entityId) =>
      createEboekhoudenInvoiceForSchedule(entityId, {
        actor: input.actor,
        settings,
      }),
    getRemainingSummary: getDueRecurringInvoiceQueueSummary,
    loadCandidates: async (mode, limit) =>
      (await listDueRecurringInvoiceCandidates(mode, limit)).map((row) => ({
        entityId: row.scheduleId,
      })),
  });
}
