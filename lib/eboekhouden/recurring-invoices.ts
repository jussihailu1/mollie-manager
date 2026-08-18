import "server-only";

import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import {
  billingSettingsAreComplete,
  getTenantActiveInvoiceProvider,
  getTenantBillingSettings,
} from "@/lib/billing-settings";
import { getCustomerAccountingLink } from "@/lib/customer-accounting-links";
import { getDb, transaction } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import {
  toInvoiceCount,
  serializeInvoiceErrorMessage,
} from "@/lib/eboekhouden/invoice-flow-helpers";
import { buildRecurringInvoiceReference } from "@/lib/eboekhouden/invoice-reference";
import { findExistingEboekhoudenInvoiceByReference } from "@/lib/eboekhouden/invoice-reconcile";
import {
  buildRecurringDueInvoiceFilter,
  buildRecurringFailedInvoiceFilter,
} from "@/lib/eboekhouden/recurring-invoice-query";
import {
  getScheduledInvoiceCandidate,
  type ScheduledInvoiceCandidate,
} from "@/lib/eboekhouden/recurring-invoice-candidate";
import {
  type RecurringInvoiceActor,
  claimScheduleForInvoice,
  storeRecurringInvoiceCreationFailure,
  storeRecurringInvoiceCreationSuccess,
} from "@/lib/eboekhouden/recurring-invoice-persistence";
import { createEboekhoudenInvoiceForSchedule } from "@/lib/eboekhouden/recurring-invoice-workflow";
import {
  getFailedRecurringInvoiceRetrySummary as getFailedRecurringInvoiceRetrySummaryImpl,
  queueRetryForFailedRecurringInvoicesBatch as queueRetryForFailedRecurringInvoicesBatchImpl,
  queueRetryForSafeFailedRecurringInvoicesBatch as queueRetryForSafeFailedRecurringInvoicesBatchImpl,
} from "@/lib/eboekhouden/recurring-invoice-retry";
import {
  listFailedRecurringRecoveryCandidates,
  storeRecoveredFailedInvoiceSuccess,
} from "@/lib/eboekhouden/recurring-invoice-recovery";
import {
  buildInvoiceCreationFailureMetadata,
} from "@/lib/eboekhouden/invoice-creation-metadata";
import {
  buildInvoiceRetryQueuedMetadata,
} from "@/lib/eboekhouden/invoice-retry-metadata";
import { createInvoiceBatchWithDependencies } from "@/lib/invoice-creation-batch";
import { deliverCustomerInvoiceEmail } from "@/lib/invoice-delivery";
import { saveStoredInvoice, type InvoiceProvider } from "@/lib/invoices";
import { getInvoiceProviderAdapterById } from "@/lib/invoicing/provider-resolver";
import { issueKifyInvoice } from "@/lib/invoicing/kify-invoice-workflow";
import type {
  InvoiceProviderCreateResult,
} from "@/lib/invoicing/provider-types";
import { openAlert } from "@/lib/reliability/alerts";

export { createEboekhoudenInvoiceForSchedule };

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

type RecurringInvoiceBatchResult = {
  actionableCount: number;
  createdCount: number;
  failedCount: number;
  remainingActionableCount: number;
  skippedCount: number;
};

type FailedRecurringRecoveryBatchResult = {
  ambiguousCount: number;
  recoveredCount: number;
  scannedCount: number;
};

type FailedRecurringRetryBatchResult = {
  queuedCount: number;
  skippedCount: number;
};

type FailedRecurringInvoiceRetrySummary = {
  retryableCount: number;
  totalFailedCount: number;
};

type CreateScheduleInvoiceResult =
  | {
      invoiceId: string | null;
      invoiceNumber: string | null;
      scheduleId: string;
      status: "created";
    }
  | {
      scheduleId: string;
      reason: string;
      status: "failed" | "skipped";
    };

function getProviderLabel(provider: InvoiceProvider) {
  return provider === "eboekhouden" ? "e-Boekhouden" : "Mollie";
}

function daysBetween(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  return Math.max(Math.round((end - start) / 86_400_000), 0);
}

async function resolveTenantId(tenantId?: string) {
  if (!tenantId) {
    throw new Error("Tenant id is required.");
  }

  return tenantId;
}

async function listProviderAgnosticDueRecurringInvoiceCandidates(
  mode: MollieMode,
  limit = DEFAULT_BATCH_SIZE,
  tenantId?: string,
) {
  const resolvedTenantId = await resolveTenantId(tenantId);
  const result = await getDb().execute<ScheduledInvoiceCandidate>(sql`
    select
      rbs.id as "scheduleId",
      rbs.subscription_id as "subscriptionId",
      rbs.mode,
      rbs.tenant_id as "tenantId",
      rbs.invoice_send_due_date::text as "invoiceSendDueDate",
      rbs.planned_collection_date::text as "plannedCollectionDate",
      rbs.amount_value::text as "amountValue",
      s.customer_id as "customerId",
      s.description as "subscriptionDescription",
      c.email as "customerEmail",
      null::int as "eboekhoudenRelationId"
    from recurring_billing_schedules rbs
    inner join subscriptions s on s.id = rbs.subscription_id and s.tenant_id = rbs.tenant_id
    inner join customers c on c.id = s.customer_id and c.tenant_id = rbs.tenant_id
    where rbs.tenant_id = ${resolvedTenantId}
      and ${buildRecurringDueInvoiceFilter(mode, resolvedTenantId)}
    order by rbs.invoice_send_due_date asc, rbs.planned_collection_date asc, rbs.created_at asc
    limit ${Math.max(1, limit)}
  `);

  return result.rows;
}

async function getProviderAgnosticDueRecurringInvoiceQueueSummary(
  mode: MollieMode,
  tenantId?: string,
): Promise<DueRecurringInvoiceQueueSummary> {
  const resolvedTenantId = await resolveTenantId(tenantId);
  const result = await getDb().execute<{
    dueCount: number | string;
  }>(sql`
    select count(*) as "dueCount"
    from recurring_billing_schedules rbs
    where rbs.tenant_id = ${resolvedTenantId}
      and ${buildRecurringDueInvoiceFilter(mode, resolvedTenantId)}
  `);
  const dueCount = toInvoiceCount(result.rows[0]?.dueCount);

  return {
    actionableCount: dueCount,
    blockedCount: 0,
    dueCount,
  };
}

async function getProviderAwareFailedRecurringRetrySummary(
  mode: MollieMode,
  tenantId?: string,
): Promise<FailedRecurringInvoiceRetrySummary> {
  const resolvedTenantId = await resolveTenantId(tenantId);
  const result = await getDb().execute<{
    totalFailedCount: number | string;
  }>(sql`
    select count(*) as "totalFailedCount"
    from recurring_billing_schedules rbs
    where rbs.tenant_id = ${resolvedTenantId}
      and ${buildRecurringFailedInvoiceFilter(mode, resolvedTenantId)}
  `);
  const totalFailedCount = toInvoiceCount(result.rows[0]?.totalFailedCount);

  return {
    retryableCount: totalFailedCount,
    totalFailedCount,
  };
}

async function queueProviderAgnosticRecurringRetries(input: {
  actor: RecurringInvoiceActor;
  mode: MollieMode;
  scheduleIds: string[];
  tenantId?: string;
}) {
  const resolvedTenantId = await resolveTenantId(input.tenantId);
  let queuedCount = 0;
  let skippedCount = 0;

  for (const scheduleId of input.scheduleIds) {
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
      where rbs.id = ${scheduleId}
        and rbs.tenant_id = ${resolvedTenantId}
        and ${buildRecurringFailedInvoiceFilter(input.mode, resolvedTenantId)}
      returning rbs.id as id
    `);

    if (result.rows[0]?.id) {
      queuedCount += 1;
    } else {
      skippedCount += 1;
    }
  }

  return {
    queuedCount,
    skippedCount,
  };
}

async function queueSafeProviderAgnosticRecurringRetries(input: {
  actor: RecurringInvoiceActor;
  limit?: number;
  mode: MollieMode;
  tenantId?: string;
}) {
  const resolvedTenantId = await resolveTenantId(input.tenantId);
  const rows = await getDb().execute<{ id: string }>(sql`
    select rbs.id as id
    from recurring_billing_schedules rbs
    where ${buildRecurringFailedInvoiceFilter(input.mode, resolvedTenantId)}
    order by rbs.updated_at asc, rbs.created_at asc
    limit ${Math.max(1, input.limit ?? DEFAULT_BATCH_SIZE)}
  `);

  return queueProviderAgnosticRecurringRetries({
    actor: input.actor,
    mode: input.mode,
    scheduleIds: rows.rows.map((row) => row.id),
    tenantId: resolvedTenantId,
  });
}

async function storeProviderRecurringInvoiceSuccess(input: {
  actor: RecurringInvoiceActor;
  candidate: ScheduledInvoiceCandidate;
  invoice: InvoiceProviderCreateResult;
  source?: "created" | "reconciled_existing";
}) {
  const providerLabel = getProviderLabel(input.invoice.provider);
  const source = input.source ?? "created";
  const invoiceId = input.invoice.providerInvoiceId;
  const invoiceNumber = input.invoice.providerInvoiceNumber;

  await transaction(async (tx) => {
    await tx.execute(sql`
      update recurring_billing_schedules
      set
        invoice_state = 'invoice_created',
        invoice_created_at = now(),
        invoice_failed_at = null,
        metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify({
          invoiceCreationCompletedAt: new Date().toISOString(),
          invoiceCreationStatus: "success",
          providerInvoice: {
            documentUrl: input.invoice.providerDocumentUrl,
            invoiceId,
            invoiceNumber,
            provider: input.invoice.provider,
          },
        })}::jsonb,
        updated_at = now()
      where id = ${input.candidate.scheduleId}
        and tenant_id = ${input.candidate.tenantId}
        and invoice_state = 'invoice_creating'
    `);

    await saveStoredInvoice(
      {
        mode: input.candidate.mode,
        ownerId: input.candidate.scheduleId,
        ownerType: "recurring_schedule",
        provider: input.invoice.provider,
        providerCustomerId: input.invoice.providerCustomerId,
        providerDocumentUrl: input.invoice.providerDocumentUrl,
        providerInvoiceId: invoiceId,
        providerInvoiceNumber: invoiceNumber,
        providerSnapshot: input.invoice.providerSnapshot,
        syncedAt: new Date().toISOString(),
        tenantId: input.candidate.tenantId,
      },
      tx,
    );

    await writeAuditLog(
      {
        action: "recurring_invoice.create",
        details: {
          invoiceProvider: input.invoice.provider,
          plannedCollectionDate: input.candidate.plannedCollectionDate,
          providerInvoiceId: invoiceId,
          providerInvoiceNumber: invoiceNumber,
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
            ? `Created a ${providerLabel} recurring invoice for a due schedule row.`
            : `Recovered an existing ${providerLabel} recurring invoice for a due schedule row.`,
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
        and payload ->> 'tenantId' = ${input.candidate.tenantId}
    `);

    await openAlert(
      {
        customerId: input.candidate.customerId,
        message:
          source === "created"
            ? `Created ${providerLabel} invoice ${invoiceNumber ?? invoiceId ?? "without returned number"} for the recurring billing row due on ${input.candidate.invoiceSendDueDate}. Automatic collection remains planned for ${input.candidate.plannedCollectionDate}.`
            : `Recovered existing ${providerLabel} invoice ${invoiceNumber ?? invoiceId ?? "without returned number"} for recurring billing row due on ${input.candidate.invoiceSendDueDate}. Automatic collection remains planned for ${input.candidate.plannedCollectionDate}.`,
        payload: {
          invoiceProvider: input.invoice.provider,
          kind: "recurring_invoice_created",
          mode: input.candidate.mode,
          plannedCollectionDate: input.candidate.plannedCollectionDate,
          providerInvoiceId: invoiceId,
          providerInvoiceNumber: invoiceNumber,
          scheduleId: input.candidate.scheduleId,
          source,
        },
        severity: "info",
        subscriptionId: input.candidate.subscriptionId,
        tenantId: input.candidate.tenantId,
        title:
          source === "created"
            ? `Recurring invoice created for ${input.candidate.plannedCollectionDate}`
            : `Recurring invoice recovered for ${input.candidate.plannedCollectionDate}`,
      },
      tx,
    );
  });

  return {
    invoiceId,
    invoiceNumber,
  };
}

async function storeProviderRecurringInvoiceFailure(input: {
  actor: RecurringInvoiceActor;
  candidate: ScheduledInvoiceCandidate;
  error: unknown;
  provider: InvoiceProvider;
}) {
  const providerLabel = getProviderLabel(input.provider);
  const errorMessage = serializeInvoiceErrorMessage(
    input.error,
    "Recurring invoice creation failed.",
  );

  await transaction(async (tx) => {
    await tx.execute(sql`
      update recurring_billing_schedules
      set
        invoice_state = 'invoice_failed',
        invoice_failed_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(
          buildInvoiceCreationFailureMetadata({ errorMessage }),
        )}::jsonb || ${JSON.stringify({
          invoiceProvider: input.provider,
        })}::jsonb,
        updated_at = now()
      where id = ${input.candidate.scheduleId}
        and tenant_id = ${input.candidate.tenantId}
        and invoice_state = 'invoice_creating'
    `);

    await writeAuditLog(
      {
        action: "recurring_invoice.create",
        details: {
          error: errorMessage,
          invoiceProvider: input.provider,
          plannedCollectionDate: input.candidate.plannedCollectionDate,
          scheduleId: input.candidate.scheduleId,
          subscriptionId: input.candidate.subscriptionId,
        },
        entityId: input.candidate.scheduleId,
        entityType: "recurring_billing_schedule",
        mode: input.candidate.mode,
        outcome: "failure",
        summary:
          `Recurring ${providerLabel} invoice creation failed for a due schedule row.`,
      },
      tx,
      input.actor,
    );

    await openAlert(
      {
        customerId: input.candidate.customerId,
        message:
          `Could not create the recurring ${providerLabel} invoice for ${input.candidate.plannedCollectionDate}. Review the schedule row before retrying so a duplicate invoice is not created upstream.`,
        payload: {
          error: errorMessage,
          invoiceProvider: input.provider,
          kind: "recurring_invoice_creation_failed",
          mode: input.candidate.mode,
          plannedCollectionDate: input.candidate.plannedCollectionDate,
          scheduleId: input.candidate.scheduleId,
        },
        severity: "warning",
        subscriptionId: input.candidate.subscriptionId,
        tenantId: input.candidate.tenantId,
        title: `Recurring invoice creation failed for ${input.candidate.plannedCollectionDate}`,
      },
      tx,
    );
  });

  return errorMessage;
}

export async function createInvoiceForSchedule(
  scheduleId: string,
  options: {
    actor?: RecurringInvoiceActor;
    tenantId: string;
  },
): Promise<CreateScheduleInvoiceResult> {
  const actor = options.actor ?? { kind: "system" as const };
  const settings = await getTenantBillingSettings(options.tenantId);
  const provider = settings?.activeInvoiceProvider ?? "mollie";

  if (provider === "eboekhouden") {
    return createEboekhoudenInvoiceForSchedule(scheduleId, {
      actor,
      settings,
      tenantId: options.tenantId,
    });
  }

  const candidate = await getScheduledInvoiceCandidate(scheduleId, options.tenantId);
  if (!candidate) {
    throw new Error("Recurring billing schedule was not found.");
  }

  if (provider === "kify") {
    const result = await issueKifyInvoice({ amountValue: candidate.amountValue, customerId: candidate.customerId, description: candidate.subscriptionDescription, dueDate: candidate.plannedCollectionDate, invoiceDate: candidate.invoiceSendDueDate, mode: candidate.mode, ownerId: candidate.scheduleId, ownerType: "recurring_schedule", paymentContext: { kind: "scheduled_collection", plannedCollectionDate: candidate.plannedCollectionDate }, tenantId: candidate.tenantId });
    return result.status === "created" ? { invoiceId: result.invoiceId, invoiceNumber: result.invoiceNumber, scheduleId, status: "created" } : { reason: result.status === "failed" ? result.reason : "Schedule was already invoiced.", scheduleId, status: result.status };
  }

  const adapter = getInvoiceProviderAdapterById(provider);
  const validation = await adapter.validateTenantSetup({
    mode: candidate.mode,
    settings,
    tenantId: options.tenantId,
  });

  if (!validation.ok) {
    throw new Error(validation.reason ?? "Tenant invoice settings are incomplete.");
  }

  const claimedScheduleId = await claimScheduleForInvoice({
    actor,
    mode: candidate.mode,
    scheduleId,
    tenantId: options.tenantId,
  });

  if (!claimedScheduleId) {
    return {
      reason: "Schedule row was already claimed or already invoiced.",
      scheduleId,
      status: "skipped",
    };
  }

  try {
    const reference = buildRecurringInvoiceReference({
      plannedCollectionDate: candidate.plannedCollectionDate,
      scheduleId: candidate.scheduleId,
    });
    const providerCustomerId = adapter.getCapabilities().requiresCustomerLink
      ? (
          await getCustomerAccountingLink({
            customerId: candidate.customerId,
            mode: candidate.mode,
            provider,
            tenantId: candidate.tenantId,
          })
        )?.providerCustomerId ?? null
      : null;

    if (adapter.getCapabilities().requiresCustomerLink && !providerCustomerId) {
      throw new Error(
        `Customer is not linked to a ${getProviderLabel(provider)} customer record.`,
      );
    }

    if (adapter.findExistingInvoice) {
      const existing = await adapter.findExistingInvoice({
        date: candidate.invoiceSendDueDate,
        providerCustomerId,
        reference,
        tenantId: candidate.tenantId,
      });

      if (existing.status === "ambiguous") {
        throw new Error(
          `Ambiguous ${getProviderLabel(provider)} invoice match for reference ${reference}; manual review required.`,
        );
      }

      if (existing.status === "found") {
        const storedRecoveredInvoice = await storeProviderRecurringInvoiceSuccess({
          actor,
          candidate,
          invoice: existing.invoice,
          source: "reconciled_existing",
        });

        await deliverCustomerInvoiceEmail({
          actor,
          customerEmail: candidate.customerEmail,
          customerId: candidate.customerId,
          entityId: candidate.scheduleId,
          invoiceDocumentUrl: existing.invoice.providerDocumentUrl,
          invoiceId: storedRecoveredInvoice.invoiceId,
          invoiceNumber: storedRecoveredInvoice.invoiceNumber,
          invoiceProvider: existing.invoice.provider,
          invoiceType: "recurring",
          mode: candidate.mode,
          plannedCollectionDate: candidate.plannedCollectionDate,
          subscriptionId: candidate.subscriptionId,
          tenantId: candidate.tenantId,
        });

        return {
          invoiceId: storedRecoveredInvoice.invoiceId,
          invoiceNumber: storedRecoveredInvoice.invoiceNumber,
          scheduleId,
          status: "created",
        };
      }
    }

    const invoice = await adapter.createInvoice({
      amountCurrency: "EUR",
      amountValue: candidate.amountValue,
      customer: {
        address: null,
        businessName: null,
        email: candidate.customerEmail,
        id: candidate.customerId,
        locale: null,
        name: null,
        phone: null,
      },
      description: candidate.subscriptionDescription,
      invoiceDate: candidate.invoiceSendDueDate,
      mode: candidate.mode,
      ownerId: candidate.scheduleId,
      ownerType: "recurring_schedule",
      plannedCollectionDate: candidate.plannedCollectionDate,
      providerCustomerId,
      reference,
      settings: settings!,
      termOfPaymentDays: daysBetween(
        candidate.invoiceSendDueDate,
        candidate.plannedCollectionDate,
      ),
      tenantId: candidate.tenantId,
    });

    const storedInvoice = await storeProviderRecurringInvoiceSuccess({
      actor,
      candidate,
      invoice,
    });

    await deliverCustomerInvoiceEmail({
      actor,
      customerEmail: candidate.customerEmail,
      customerId: candidate.customerId,
      entityId: candidate.scheduleId,
      invoiceDocumentUrl: invoice.providerDocumentUrl,
      invoiceId: storedInvoice.invoiceId,
      invoiceNumber: storedInvoice.invoiceNumber,
      invoiceProvider: invoice.provider,
      invoiceType: "recurring",
      mode: candidate.mode,
      plannedCollectionDate: candidate.plannedCollectionDate,
      subscriptionId: candidate.subscriptionId,
      tenantId: candidate.tenantId,
    });

    return {
      invoiceId: storedInvoice.invoiceId,
      invoiceNumber: storedInvoice.invoiceNumber,
      scheduleId,
      status: "created",
    };
  } catch (error) {
    const errorMessage = await storeProviderRecurringInvoiceFailure({
      actor,
      candidate,
      error,
      provider,
    });

    return {
      reason: errorMessage,
      scheduleId,
      status: "failed",
    };
  }
}

export async function getDueRecurringInvoiceQueueSummary(
  mode: MollieMode,
  tenantId?: string,
): Promise<DueRecurringInvoiceQueueSummary> {
  const resolvedTenantId = await resolveTenantId(tenantId);
  const provider = await getTenantActiveInvoiceProvider(resolvedTenantId);

  if (provider === "eboekhouden") {
    const result = await getDb().execute<{
      actionableCount: number | string;
      blockedCount: number | string;
      dueCount: number | string;
    }>(sql`
      select
        count(*) filter (where cal.provider_customer_id is not null) as "actionableCount",
        count(*) filter (where cal.provider_customer_id is null) as "blockedCount",
        count(*) as "dueCount"
      from recurring_billing_schedules rbs
      inner join subscriptions s on s.id = rbs.subscription_id and s.tenant_id = rbs.tenant_id
      inner join customers c on c.id = s.customer_id and c.tenant_id = rbs.tenant_id
      left join customer_accounting_links cal
        on cal.customer_id = c.id
        and cal.tenant_id = c.tenant_id
        and cal.mode = rbs.mode
        and cal.provider = 'eboekhouden'
      where rbs.tenant_id = ${resolvedTenantId}
        and ${buildRecurringDueInvoiceFilter(mode, resolvedTenantId)}
    `);
    const row = result.rows[0];

    return {
      actionableCount: toInvoiceCount(row?.actionableCount),
      blockedCount: toInvoiceCount(row?.blockedCount),
      dueCount: toInvoiceCount(row?.dueCount),
    };
  }

  return getProviderAgnosticDueRecurringInvoiceQueueSummary(mode, resolvedTenantId);
}

export async function getFailedRecurringInvoiceRetrySummary(
  mode: MollieMode,
  tenantId?: string,
): Promise<FailedRecurringInvoiceRetrySummary> {
  const resolvedTenantId = await resolveTenantId(tenantId);
  const provider = await getTenantActiveInvoiceProvider(resolvedTenantId);

  return provider === "eboekhouden"
    ? getFailedRecurringInvoiceRetrySummaryImpl(mode, resolvedTenantId)
    : getProviderAwareFailedRecurringRetrySummary(mode, resolvedTenantId);
}

export async function queueRetryForFailedRecurringInvoicesBatch(input: {
  actor: RecurringInvoiceActor;
  mode: MollieMode;
  scheduleIds: string[];
  tenantId?: string;
}): Promise<FailedRecurringRetryBatchResult> {
  const resolvedTenantId = await resolveTenantId(input.tenantId);
  const provider = await getTenantActiveInvoiceProvider(resolvedTenantId);

  return provider === "eboekhouden"
    ? queueRetryForFailedRecurringInvoicesBatchImpl({
        ...input,
        tenantId: resolvedTenantId,
      })
    : queueProviderAgnosticRecurringRetries({
        ...input,
        tenantId: resolvedTenantId,
      });
}

export async function queueRetryForSafeFailedRecurringInvoicesBatch(input: {
  actor: RecurringInvoiceActor;
  limit?: number;
  mode: MollieMode;
  tenantId?: string;
}) {
  const resolvedTenantId = await resolveTenantId(input.tenantId);
  const provider = await getTenantActiveInvoiceProvider(resolvedTenantId);

  return provider === "eboekhouden"
    ? queueRetryForSafeFailedRecurringInvoicesBatchImpl({
        ...input,
        tenantId: resolvedTenantId,
      })
    : queueSafeProviderAgnosticRecurringRetries({
        ...input,
        tenantId: resolvedTenantId,
      });
}

export async function recoverFailedRecurringInvoicesBatch(input: {
  actor: InvoiceActor;
  limit?: number;
  mode: MollieMode;
  tenantId?: string;
}): Promise<FailedRecurringRecoveryBatchResult> {
  const resolvedTenantId = await resolveTenantId(input.tenantId);
  const provider = await getTenantActiveInvoiceProvider(resolvedTenantId);

  if (provider !== "eboekhouden") {
    return {
      ambiguousCount: 0,
      recoveredCount: 0,
      scannedCount: 0,
    };
  }

  const candidates = await listFailedRecurringRecoveryCandidates(
    input.mode,
    input.limit ?? DEFAULT_BATCH_SIZE,
    resolvedTenantId,
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
      tenantId: candidate.tenantId,
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
      entityId: candidate.scheduleId,
      invoiceDocumentUrl: existing.invoice.urlPdfFile ?? null,
      invoiceId: recovered.invoiceId,
      invoiceNumber: recovered.invoiceNumber,
      invoiceProvider: "eboekhouden",
      invoiceType: "recurring",
      mode: candidate.mode,
      plannedCollectionDate: candidate.plannedCollectionDate,
      subscriptionId: candidate.subscriptionId,
      tenantId: candidate.tenantId,
    });
  }

  return {
    ambiguousCount,
    recoveredCount,
    scannedCount: candidates.length,
  };
}

export async function createDueRecurringInvoicesBatch(input: {
  actor: InvoiceActor;
  limit?: number;
  mode: MollieMode;
  tenantId: string;
}): Promise<RecurringInvoiceBatchResult> {
  const settings = await getTenantBillingSettings(input.tenantId);
  const provider = settings?.activeInvoiceProvider ?? "mollie";
  if (provider !== "kify") {
    const adapter = getInvoiceProviderAdapterById(provider);
    const validation = await adapter.validateTenantSetup({
      mode: input.mode,
      settings,
      tenantId: input.tenantId,
    });

    if (!validation.ok || !billingSettingsAreComplete(settings)) {
      throw new Error(
        validation.reason ??
          "Tenant billing settings are incomplete. Select invoice settings first.",
      );
    }
  }

  return createInvoiceBatchWithDependencies(input, {
    createInvoice: async (entityId) =>
      createInvoiceForSchedule(entityId, {
        actor: input.actor,
        tenantId: input.tenantId,
      }),
    getRemainingSummary: async (mode) =>
      getDueRecurringInvoiceQueueSummary(mode, input.tenantId),
    loadCandidates: async (mode, limit) => {
      const activeProvider = await getTenantActiveInvoiceProvider(input.tenantId);
      const rows =
        activeProvider === "eboekhouden"
          ? await getDb().execute<ScheduledInvoiceCandidate>(sql`
              select
                rbs.id as "scheduleId",
                rbs.subscription_id as "subscriptionId",
                rbs.mode,
                rbs.tenant_id as "tenantId",
                rbs.invoice_send_due_date::text as "invoiceSendDueDate",
                rbs.planned_collection_date::text as "plannedCollectionDate",
                rbs.amount_value::text as "amountValue",
                s.customer_id as "customerId",
                s.description as "subscriptionDescription",
                c.email as "customerEmail",
                case
                  when cal.provider_customer_id ~ '^[0-9]+$'
                    then cal.provider_customer_id::int
                  else null
                end as "eboekhoudenRelationId"
              from recurring_billing_schedules rbs
              inner join subscriptions s on s.id = rbs.subscription_id and s.tenant_id = rbs.tenant_id
              inner join customers c on c.id = s.customer_id and c.tenant_id = rbs.tenant_id
              left join customer_accounting_links cal
                on cal.customer_id = c.id
                and cal.tenant_id = c.tenant_id
                and cal.mode = rbs.mode
                and cal.provider = 'eboekhouden'
              where rbs.tenant_id = ${input.tenantId}
                and ${buildRecurringDueInvoiceFilter(mode, input.tenantId)}
                and cal.provider_customer_id is not null
              order by rbs.invoice_send_due_date asc, rbs.planned_collection_date asc, rbs.created_at asc
              limit ${Math.max(1, limit)}
            `)
          : { rows: await listProviderAgnosticDueRecurringInvoiceCandidates(mode, limit, input.tenantId) };

      return rows.rows.map((row) => ({
        entityId: row.scheduleId,
      }));
    },
  });
}
