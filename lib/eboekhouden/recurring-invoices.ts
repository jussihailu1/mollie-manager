import "server-only";

import { sql } from "drizzle-orm";

import {
  billingSettingsAreComplete,
  getTenantBillingSettings,
} from "@/lib/billing-settings";
import { getDb } from "@/lib/db";
import {
  toInvoiceCount,
} from "@/lib/eboekhouden/invoice-flow-helpers";
import { buildRecurringInvoiceReference } from "@/lib/eboekhouden/invoice-reference";
import { findExistingEboekhoudenInvoiceByReference } from "@/lib/eboekhouden/invoice-reconcile";
import {
  buildRecurringDueInvoiceFilter,
} from "@/lib/eboekhouden/recurring-invoice-query";
import {
  type ScheduledInvoiceCandidate,
} from "@/lib/eboekhouden/recurring-invoice-candidate";
import { createEboekhoudenInvoiceForSchedule } from "@/lib/eboekhouden/recurring-invoice-workflow";
import {
  getFailedRecurringInvoiceRetrySummary,
  queueRetryForFailedRecurringInvoicesBatch,
  queueRetryForSafeFailedRecurringInvoicesBatch,
} from "@/lib/eboekhouden/recurring-invoice-retry";
import {
  listFailedRecurringRecoveryCandidates,
  storeRecoveredFailedInvoiceSuccess,
} from "@/lib/eboekhouden/recurring-invoice-recovery";
import { createInvoiceBatchWithDependencies } from "@/lib/invoice-creation-batch";
import { deliverCustomerInvoiceEmail } from "@/lib/invoice-delivery";
import { getSingleTenantIdOrThrow } from "@/lib/tenants";

export { createEboekhoudenInvoiceForSchedule };
export {
  getFailedRecurringInvoiceRetrySummary,
  queueRetryForFailedRecurringInvoicesBatch,
  queueRetryForSafeFailedRecurringInvoicesBatch,
};

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

async function resolveTenantId(tenantId?: string) {
  return tenantId ?? (await getSingleTenantIdOrThrow());
}

async function listDueRecurringInvoiceCandidates(
  mode: "live" | "test",
  limit = DEFAULT_BATCH_SIZE,
  tenantId?: string,
) {
  const resolvedTenantId = await resolveTenantId(tenantId);
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
    inner join subscriptions s on s.id = rbs.subscription_id and s.tenant_id = rbs.tenant_id
    inner join customers c on c.id = s.customer_id and c.tenant_id = rbs.tenant_id
    where rbs.tenant_id = ${resolvedTenantId}
      and ${buildRecurringDueInvoiceFilter(mode, resolvedTenantId)}
      and c.eboekhouden_relation_id is not null
    order by rbs.invoice_send_due_date asc, rbs.planned_collection_date asc, rbs.created_at asc
    limit ${Math.max(1, limit)}
  `);

  return result.rows;
}

export async function getDueRecurringInvoiceQueueSummary(
  mode: "live" | "test",
  tenantId?: string,
): Promise<DueRecurringInvoiceQueueSummary> {
  const resolvedTenantId = await resolveTenantId(tenantId);
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
    inner join subscriptions s on s.id = rbs.subscription_id and s.tenant_id = rbs.tenant_id
    inner join customers c on c.id = s.customer_id and c.tenant_id = rbs.tenant_id
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

export async function recoverFailedRecurringInvoicesBatch(input: {
  actor: InvoiceActor;
  limit?: number;
  mode: "live" | "test";
  tenantId?: string;
}): Promise<FailedRecurringRecoveryBatchResult> {
  const candidates = await listFailedRecurringRecoveryCandidates(
    input.mode,
    input.limit ?? DEFAULT_BATCH_SIZE,
    input.tenantId,
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
  mode: "live" | "test";
  tenantId?: string;
}): Promise<RecurringInvoiceBatchResult> {
  const settings = await getTenantBillingSettings(input.tenantId);

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
    getRemainingSummary: async (mode) =>
      getDueRecurringInvoiceQueueSummary(mode, input.tenantId),
    loadCandidates: async (mode, limit) =>
      (await listDueRecurringInvoiceCandidates(mode, limit, input.tenantId)).map((row) => ({
        entityId: row.scheduleId,
      })),
  });
}
