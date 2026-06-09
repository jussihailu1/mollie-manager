import "server-only";

import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import {
  billingSettingsAreComplete,
  getTenantBillingSettings,
  type TenantBillingSettings,
} from "@/lib/billing-settings";
import { getDb, transaction } from "@/lib/db";
import { createEboekhoudenInvoice, type EboekhoudenInvoice } from "@/lib/eboekhouden/client";
import {
  isSafeInvoiceRetryFailure,
  SAFE_INVOICE_RETRY_FAILURE_CODES,
} from "@/lib/eboekhouden/invoice-failure-retry";
import {
  isEboekhoudenReferenceAlreadyExistsError,
  serializeInvoiceErrorMessage,
  toInvoiceAmountNumber,
  toInvoiceCount,
} from "@/lib/eboekhouden/invoice-flow-helpers";
import { buildRecurringInvoiceReference } from "@/lib/eboekhouden/invoice-reference";
import { findExistingEboekhoudenInvoiceByReference } from "@/lib/eboekhouden/invoice-reconcile";
import { buildInvoiceRetryQueuedMetadata } from "@/lib/eboekhouden/invoice-retry-metadata";
import {
  buildInvoiceCreationClaimMetadata,
  buildInvoiceCreationFailureMetadata,
  buildInvoiceCreationSuccessMetadata,
} from "@/lib/eboekhouden/invoice-creation-metadata";
import { countSafeInvoiceRetryFailures } from "@/lib/eboekhouden/invoice-retry-summary";
import { createInvoiceBatchWithDependencies } from "@/lib/invoice-creation-batch";
import { deliverCustomerInvoiceEmail } from "@/lib/invoice-delivery";
import { notificationsAreConfigured } from "@/lib/notifications/email";
import { deliverAlertEmail, openAlert } from "@/lib/reliability/alerts";

const DEFAULT_BATCH_SIZE = 25;
type InvoiceActor = {
  email?: string | null;
  kind: "system" | "user";
};

type ScheduledInvoiceCandidate = {
  amountValue: string;
  customerEmail: string;
  customerId: string;
  eboekhoudenRelationId: number | null;
  invoiceSendDueDate: string;
  mode: "live" | "test";
  plannedCollectionDate: string;
  scheduleId: string;
  subscriptionDescription: string;
  subscriptionId: string;
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

type FailedRecurringRecoveryCandidate = {
  customerEmail: string;
  customerId: string;
  eboekhoudenRelationId: number;
  invoiceSendDueDate: string;
  mode: "live" | "test";
  plannedCollectionDate: string;
  scheduleId: string;
  subscriptionId: string;
};

type AlertResult = {
  id: string;
  isNew: boolean;
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

function serializeErrorMessage(error: unknown) {
  return serializeInvoiceErrorMessage(error, "Recurring invoice creation failed.");
}

function buildReference(candidate: ScheduledInvoiceCandidate) {
  return buildRecurringInvoiceReference({
    plannedCollectionDate: candidate.plannedCollectionDate,
    scheduleId: candidate.scheduleId,
  });
}

async function getScheduledInvoiceCandidate(scheduleId: string) {
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
    where rbs.id = ${scheduleId}
    limit 1
  `);

  return result.rows[0] ?? null;
}

async function claimScheduleForInvoice(input: {
  actor: InvoiceActor;
  mode: "live" | "test";
  scheduleId: string;
}) {
  const result = await getDb().execute<{ id: string }>(sql`
    update recurring_billing_schedules
    set
      invoice_state = 'invoice_creating',
      invoice_failed_at = null,
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(
        buildInvoiceCreationClaimMetadata({
          actorEmail: input.actor.email,
        }),
      )}::jsonb
    where id = ${input.scheduleId}
      and mode = ${input.mode}
      and invoice_state = 'pending_invoice'
      and eboekhouden_invoice_id is null
      and eboekhouden_invoice_number is null
    returning id
  `);

  return result.rows[0]?.id ?? null;
}

async function storeInvoiceCreationSuccess(input: {
  actor: InvoiceActor;
  candidate: ScheduledInvoiceCandidate;
  invoice: EboekhoudenInvoice;
  source?: "created" | "reconciled_existing";
}) {
  const invoiceId = input.invoice.id ? String(input.invoice.id) : null;
  const invoiceNumber = input.invoice.invoiceNumber ?? input.invoice.number ?? null;
  const source = input.source ?? "created";
  const alertResult = await transaction<AlertResult>(async (tx) => {
    await tx.execute(sql`
      update recurring_billing_schedules
      set
        invoice_state = 'invoice_created',
        eboekhouden_invoice_id = ${invoiceId},
        eboekhouden_invoice_number = ${invoiceNumber},
        invoice_created_at = now(),
        invoice_failed_at = null,
        metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(
          buildInvoiceCreationSuccessMetadata({ invoice: input.invoice }),
        )}::jsonb,
        updated_at = now()
      where id = ${input.candidate.scheduleId}
        and invoice_state = 'invoice_creating'
    `);

    await writeAuditLog(
      {
        action: "recurring_invoice.create",
        details: {
          eboekhoudenInvoiceId: invoiceId,
          eboekhoudenInvoiceNumber: invoiceNumber,
          plannedCollectionDate: input.candidate.plannedCollectionDate,
          scheduleId: input.candidate.scheduleId,
          source,
          subscriptionId: input.candidate.subscriptionId,
        },
        entityId: input.candidate.scheduleId,
        entityType: "recurring_billing_schedule",
        mode: input.candidate.mode,
        outcome: "success",
        summary:
          source === "created"
            ? "Created an e-Boekhouden recurring invoice for a due schedule row."
            : "Recovered an existing e-Boekhouden recurring invoice for a due schedule row.",
      },
      tx,
      input.actor,
    );

    await tx.execute(sql`
      update alerts
      set
        status = 'resolved',
        resolved_at = now(),
        updated_at = now()
      where status = 'open'
        and payload ->> 'kind' = 'recurring_invoice_creation_failed'
        and payload ->> 'scheduleId' = ${input.candidate.scheduleId}
    `);

    return openAlert(
      {
        customerId: input.candidate.customerId,
        message:
          source === "created"
            ? `Created e-Boekhouden invoice ${invoiceNumber ?? invoiceId ?? "without returned number"} for the recurring billing row due on ${input.candidate.invoiceSendDueDate}. Automatic collection remains planned for ${input.candidate.plannedCollectionDate}.`
            : `Recovered existing e-Boekhouden invoice ${invoiceNumber ?? invoiceId ?? "without returned number"} for recurring billing row due on ${input.candidate.invoiceSendDueDate}. Automatic collection remains planned for ${input.candidate.plannedCollectionDate}.`,
        payload: {
          eboekhoudenInvoiceId: invoiceId,
          eboekhoudenInvoiceNumber: invoiceNumber,
          kind: "recurring_invoice_created",
          mode: input.candidate.mode,
          plannedCollectionDate: input.candidate.plannedCollectionDate,
          scheduleId: input.candidate.scheduleId,
          source,
        },
        severity: "info",
        subscriptionId: input.candidate.subscriptionId,
        title:
          source === "created"
            ? `Recurring invoice created for ${input.candidate.plannedCollectionDate}`
            : `Recurring invoice recovered for ${input.candidate.plannedCollectionDate}`,
      },
      tx,
    );
  });

  return {
    alert: alertResult,
    invoiceId,
    invoiceNumber,
  };
}

async function storeInvoiceCreationFailure(input: {
  actor: InvoiceActor;
  candidate: ScheduledInvoiceCandidate;
  error: unknown;
}) {
  const errorMessage = serializeErrorMessage(input.error);
  const alertResult = await transaction<AlertResult>(async (tx) => {
    await tx.execute(sql`
      update recurring_billing_schedules
      set
        invoice_state = 'invoice_failed',
        invoice_failed_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(
          buildInvoiceCreationFailureMetadata({ errorMessage }),
        )}::jsonb,
        updated_at = now()
      where id = ${input.candidate.scheduleId}
        and invoice_state = 'invoice_creating'
    `);

    await writeAuditLog(
      {
        action: "recurring_invoice.create",
        details: {
          error: errorMessage,
          plannedCollectionDate: input.candidate.plannedCollectionDate,
          scheduleId: input.candidate.scheduleId,
          subscriptionId: input.candidate.subscriptionId,
        },
        entityId: input.candidate.scheduleId,
        entityType: "recurring_billing_schedule",
        mode: input.candidate.mode,
        outcome: "failure",
        summary: "Recurring invoice creation failed for a due schedule row.",
      },
      tx,
      input.actor,
    );

    return openAlert(
      {
        customerId: input.candidate.customerId,
        message: `Could not create the recurring e-Boekhouden invoice for ${input.candidate.plannedCollectionDate}. Review the schedule row before retrying so a duplicate invoice is not created upstream.`,
        payload: {
          error: errorMessage,
          kind: "recurring_invoice_creation_failed",
          mode: input.candidate.mode,
          plannedCollectionDate: input.candidate.plannedCollectionDate,
          scheduleId: input.candidate.scheduleId,
        },
        severity: "warning",
        subscriptionId: input.candidate.subscriptionId,
        title: `Recurring invoice creation failed for ${input.candidate.plannedCollectionDate}`,
      },
      tx,
    );
  });

  if (alertResult.isNew && notificationsAreConfigured()) {
    await deliverAlertEmail({
      alertId: alertResult.id,
      message: [
        "Recurring e-Boekhouden invoice creation failed.",
        "",
        `Customer email: ${input.candidate.customerEmail}`,
        `Subscription: ${input.candidate.subscriptionId}`,
        `Schedule row: ${input.candidate.scheduleId}`,
        `Planned collection date: ${input.candidate.plannedCollectionDate}`,
        `Error: ${errorMessage}`,
      ].join("\n"),
      title: "Recurring invoice creation failed",
    });
  }

  return errorMessage;
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
    where rbs.mode = ${mode}
      and rbs.invoice_state = 'pending_invoice'
      and rbs.invoice_send_due_date <= current_date
      and rbs.eboekhouden_invoice_id is null
      and rbs.eboekhouden_invoice_number is null
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
    where rbs.mode = ${mode}
      and rbs.invoice_state = 'pending_invoice'
      and rbs.invoice_send_due_date <= current_date
      and rbs.eboekhouden_invoice_id is null
      and rbs.eboekhouden_invoice_number is null
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
    where rbs.mode = ${mode}
      and rbs.invoice_state = 'invoice_failed'
      and rbs.eboekhouden_invoice_id is null
      and rbs.eboekhouden_invoice_number is null
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
      and rbs.mode = ${input.mode}
      and rbs.invoice_state = 'invoice_failed'
      and rbs.eboekhouden_invoice_id is null
      and rbs.eboekhouden_invoice_number is null
    limit 1
  `);
  const row = candidate.rows[0];

  if (!row || !isSafeInvoiceRetryFailure(row.errorMessage)) {
    return "skipped";
  }

  const result = await getDb().execute<{ id: string }>(sql`
    update recurring_billing_schedules
    set
      invoice_state = 'pending_invoice',
      invoice_failed_at = null,
      metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(
        buildInvoiceRetryQueuedMetadata({
          actorEmail: input.actor.email,
        }),
      )}::jsonb,
      updated_at = now()
    where id = ${input.scheduleId}
      and mode = ${input.mode}
      and invoice_state = 'invoice_failed'
      and eboekhouden_invoice_id is null
      and eboekhouden_invoice_number is null
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
    scheduleId: string;
  }>(sql`
    select
      rbs.id as "scheduleId",
      (rbs.metadata ->> 'invoiceCreationError') as "errorMessage"
    from recurring_billing_schedules rbs
    where rbs.mode = ${input.mode}
      and rbs.invoice_state = 'invoice_failed'
      and rbs.eboekhouden_invoice_id is null
      and rbs.eboekhouden_invoice_number is null
    order by rbs.updated_at asc, rbs.created_at asc
    limit ${Math.max(1, input.limit ?? DEFAULT_BATCH_SIZE)}
  `);
  const safeScheduleIds = failedRows.rows
    .filter((row) => isSafeInvoiceRetryFailure(row.errorMessage))
    .map((row) => row.scheduleId);

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

async function listFailedRecurringRecoveryCandidates(
  mode: "live" | "test",
  limit: number,
) {
  const result = await getDb().execute<FailedRecurringRecoveryCandidate>(sql`
    select
      rbs.id as "scheduleId",
      rbs.mode,
      rbs.invoice_send_due_date::text as "invoiceSendDueDate",
      rbs.planned_collection_date::text as "plannedCollectionDate",
      rbs.subscription_id as "subscriptionId",
      s.customer_id as "customerId",
      c.email as "customerEmail",
      c.eboekhouden_relation_id as "eboekhoudenRelationId"
    from recurring_billing_schedules rbs
    inner join subscriptions s on s.id = rbs.subscription_id
    inner join customers c on c.id = s.customer_id and c.mode = rbs.mode
    where rbs.mode = ${mode}
      and rbs.invoice_state = 'invoice_failed'
      and rbs.eboekhouden_invoice_id is null
      and rbs.eboekhouden_invoice_number is null
      and c.eboekhouden_relation_id is not null
    order by rbs.updated_at asc, rbs.created_at asc
    limit ${Math.max(1, limit)}
  `);

  return result.rows;
}

async function storeRecoveredFailedInvoiceSuccess(input: {
  actor: InvoiceActor;
  candidate: FailedRecurringRecoveryCandidate;
  invoice: EboekhoudenInvoice;
}) {
  const invoiceId = input.invoice.id ? String(input.invoice.id) : null;
  const invoiceNumber = input.invoice.invoiceNumber ?? input.invoice.number ?? null;
  const result = await getDb().execute<{ id: string }>(sql`
    update recurring_billing_schedules
    set
      invoice_state = 'invoice_created',
      eboekhouden_invoice_id = ${invoiceId},
      eboekhouden_invoice_number = ${invoiceNumber},
      invoice_created_at = coalesce(invoice_created_at, now()),
      invoice_failed_at = null,
      metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify({
        eboekhoudenInvoice: input.invoice,
        invoiceRecoveredAt: new Date().toISOString(),
        invoiceRecoverySource: "reconciled_existing",
      })}::jsonb,
      updated_at = now()
    where id = ${input.candidate.scheduleId}
      and invoice_state = 'invoice_failed'
      and eboekhouden_invoice_id is null
      and eboekhouden_invoice_number is null
    returning id
  `);

  if (!result.rows[0]?.id) {
    return null;
  }

  await writeAuditLog(
    {
      action: "recurring_invoice.recover_failed",
      details: {
        eboekhoudenInvoiceId: invoiceId,
        eboekhoudenInvoiceNumber: invoiceNumber,
        plannedCollectionDate: input.candidate.plannedCollectionDate,
        scheduleId: input.candidate.scheduleId,
        source: "reconciled_existing",
      },
      entityId: input.candidate.scheduleId,
      entityType: "recurring_billing_schedule",
      mode: input.candidate.mode,
      outcome: "success",
      summary:
        "Recovered failed recurring invoice row by reconciling existing e-Boekhouden invoice.",
    },
    undefined,
    input.actor,
  );

  return {
    invoiceId,
    invoiceNumber,
  };
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
      const storedRecoveredInvoice = await storeInvoiceCreationSuccess({
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
    const storedInvoice = await storeInvoiceCreationSuccess({
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
        const storedRecoveredInvoice = await storeInvoiceCreationSuccess({
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

    const errorMessage = await storeInvoiceCreationFailure({
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
