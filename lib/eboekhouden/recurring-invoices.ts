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

type RecurringInvoiceBatchResult = {
  actionableCount: number;
  createdCount: number;
  failedCount: number;
  remainingActionableCount: number;
  skippedCount: number;
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

function toNumberAmount(value: string) {
  return Number(Number(value).toFixed(2));
}

function toCount(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return Number(value);
  }

  return 0;
}

function serializeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message.slice(0, 500);
  }

  return "Recurring invoice creation failed.";
}

function buildReference(candidate: ScheduledInvoiceCandidate) {
  return `Subscription ${candidate.subscriptionId} / ${candidate.plannedCollectionDate}`;
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
      metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify({
        invoiceCreationClaimedAt: new Date().toISOString(),
        invoiceCreationClaimedBy: input.actor.email ?? null,
      })}::jsonb
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
}) {
  const invoiceId = input.invoice.id ? String(input.invoice.id) : null;
  const invoiceNumber = input.invoice.invoiceNumber ?? input.invoice.number ?? null;
  const alertResult = await transaction<AlertResult>(async (tx) => {
    await tx.execute(sql`
      update recurring_billing_schedules
      set
        invoice_state = 'invoice_created',
        eboekhouden_invoice_id = ${invoiceId},
        eboekhouden_invoice_number = ${invoiceNumber},
        invoice_created_at = now(),
        invoice_failed_at = null,
        metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify({
          eboekhoudenInvoice: input.invoice,
          invoiceCreationCompletedAt: new Date().toISOString(),
          invoiceCreationStatus: "success",
        })}::jsonb,
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
          subscriptionId: input.candidate.subscriptionId,
        },
        entityId: input.candidate.scheduleId,
        entityType: "recurring_billing_schedule",
        mode: input.candidate.mode,
        outcome: "success",
        summary: "Created an e-Boekhouden recurring invoice for a due schedule row.",
      },
      tx,
      input.actor,
    );

    return openAlert(
      {
        customerId: input.candidate.customerId,
        message: `Created e-Boekhouden invoice ${invoiceNumber ?? invoiceId ?? "without returned number"} for the recurring billing row due on ${input.candidate.invoiceSendDueDate}. Automatic collection remains planned for ${input.candidate.plannedCollectionDate}.`,
        payload: {
          eboekhoudenInvoiceId: invoiceId,
          eboekhoudenInvoiceNumber: invoiceNumber,
          kind: "recurring_invoice_created",
          mode: input.candidate.mode,
          plannedCollectionDate: input.candidate.plannedCollectionDate,
          scheduleId: input.candidate.scheduleId,
        },
        severity: "info",
        subscriptionId: input.candidate.subscriptionId,
        title: `Recurring invoice created for ${input.candidate.plannedCollectionDate}`,
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
        metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify({
          invoiceCreationCompletedAt: new Date().toISOString(),
          invoiceCreationError: errorMessage,
          invoiceCreationStatus: "failure",
        })}::jsonb,
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
    actionableCount: toCount(row?.actionableCount),
    blockedCount: toCount(row?.blockedCount),
    dueCount: toCount(row?.dueCount),
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

  try {
    const invoice = await createEboekhoudenInvoice({
      date: candidate.invoiceSendDueDate,
      inExVat: "EX",
      items: [
        {
          description: candidate.subscriptionDescription,
          ledgerId: settings!.revenueLedgerId!,
          pricePerUnit: toNumberAmount(candidate.amountValue),
          quantity: 1,
          vatCode: settings!.vatCode,
        },
      ],
      print: false,
      reference: buildReference(candidate),
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

    return {
      invoiceId: storedInvoice.invoiceId,
      invoiceNumber: storedInvoice.invoiceNumber,
      scheduleId,
      status: "created",
    };
  } catch (error) {
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

  const candidates = await listDueRecurringInvoiceCandidates(
    input.mode,
    input.limit ?? DEFAULT_BATCH_SIZE,
  );
  let createdCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const candidate of candidates) {
    const result = await createEboekhoudenInvoiceForSchedule(candidate.scheduleId, {
      actor: input.actor,
      settings,
    });

    if (result.status === "created") {
      createdCount += 1;
      continue;
    }

    if (result.status === "failed") {
      failedCount += 1;
      continue;
    }

    skippedCount += 1;
  }

  const remainingSummary = await getDueRecurringInvoiceQueueSummary(input.mode);

  return {
    actionableCount: candidates.length,
    createdCount,
    failedCount,
    remainingActionableCount: remainingSummary.actionableCount,
    skippedCount,
  };
}
