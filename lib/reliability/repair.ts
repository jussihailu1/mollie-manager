import "server-only";

import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { REPAIR_STALE_AFTER_MS } from "@/lib/freshness";
import { repairCustomerBillingState } from "@/lib/onboarding/actions";
import {
  syncPaymentByMollieId,
  syncPaymentLinkByMollieId,
  syncSubscriptionByMollieId,
} from "@/lib/reliability/sync";
import type { MollieMode } from "@/lib/env";

export type RepairActor = {
  email?: string | null;
  kind: "system" | "user";
};

export type RepairTargetKind = "customer" | "payment" | "subscription";

export type RepairTargetResult = {
  id: string;
  kind: RepairTargetKind;
  reason?: string;
  status: "repaired" | "skipped";
};

export type RepairBatchResult = {
  customersChecked: number;
  paymentsChecked: number;
  repairedCount: number;
  skippedCount: number;
  subscriptionsChecked: number;
  totalChecked: number;
};

type CustomerCandidate = {
  eboekhoudenLinkStatus: "linked" | "unlinked" | "needs_review" | "sync_error";
  id: string;
  lastSyncedAt: string | null;
  mode: MollieMode;
  priority: number;
};

type PaymentCandidate = {
  id: string;
  customerId: string | null;
  lastSyncedAt: string | null;
  mode: MollieMode;
  priority: number;
};

type SubscriptionCandidate = {
  id: string;
  customerId: string;
  lastSyncedAt: string | null;
  localStatus: string;
  mode: MollieMode;
  priority: number;
};

type LocalPaymentLookup = {
  id: string;
  molliePaymentId: string | null;
  mode: MollieMode;
};

type LocalSubscriptionLookup = {
  id: string;
  mollieSubscriptionId: string | null;
  mode: MollieMode;
};

type FailedWebhookCandidate = {
  errorMessage: string | null;
  id: string;
  mode: MollieMode;
  resourceId: string | null;
  resourceType: string | null;
  retryCount: number;
};

function normalizeLimit(limit: number) {
  return Math.min(Math.max(Math.trunc(limit), 1), 25);
}

function toMillis(value: string | null) {
  return value ? new Date(value).getTime() : Number.NEGATIVE_INFINITY;
}

function buildCandidateThresholdExpression() {
  return sql`now() - ${REPAIR_STALE_AFTER_MS} * interval '1 millisecond'`;
}

async function processWebhookResource(
  resourceId: string,
  mode: MollieMode,
  actor: RepairActor,
  tenantId: string,
) {
  if (resourceId.startsWith("tr_")) {
    return syncPaymentByMollieId(resourceId, {
      actor,
      preferredMode: mode,
      strictMode: true,
      tenantId,
    });
  }

  if (resourceId.startsWith("sub_")) {
    return syncSubscriptionByMollieId(resourceId, {
      actor,
      preferredMode: mode,
      strictMode: true,
      tenantId,
    });
  }

  if (resourceId.startsWith("pl_")) {
    return syncPaymentLinkByMollieId(resourceId, {
      actor,
      preferredMode: mode,
      strictMode: true,
      tenantId,
    });
  }

  throw new Error("Unsupported webhook resource id.");
}

async function updateWebhookEventStatus(
  input: {
    errorMessage?: string | null;
    id: string;
    processed: boolean;
    tenantId?: string;
  },
) {
  await getDb().execute(sql`
      update webhook_events
      set
        processing_status = ${input.processed ? "processed" : "failed"},
        error_message = ${input.errorMessage ?? null},
        retry_count = retry_count + 1,
        last_attempt_at = now(),
        processed_at = case
          when ${input.processed}
            then now()
          else processed_at
        end
      where id = ${input.id}
        and (${input.tenantId ?? null}::text is null or tenant_id = ${input.tenantId ?? null})
    `);
}

async function listFailedWebhookCandidatesForTenant(
  mode: MollieMode,
  limit: number,
  tenantId: string,
) {
  const result = await getDb().execute<FailedWebhookCandidate>(sql`
      select
        id,
        mode,
        resource_id as "resourceId",
        resource_type as "resourceType",
        error_message as "errorMessage",
        retry_count as "retryCount"
      from webhook_events
      where mode = ${mode}
        and tenant_id = ${tenantId}
        and processing_status = 'failed'
        and resource_id is not null
      order by
        coalesce(last_attempt_at, received_at) asc,
        received_at desc
      limit ${limit}
    `);

  return result.rows;
}

async function listCustomerCandidates(
  mode: MollieMode,
  limit: number,
  tenantId: string,
) {
  const result = await getDb().execute<CustomerCandidate>(sql`
      select
        c.id,
        c.mode,
        c.eboekhouden_link_status as "eboekhoudenLinkStatus",
        c.last_synced_at as "lastSyncedAt",
        case
          when c.eboekhouden_link_status in ('needs_review', 'sync_error') then 0
          when c.last_synced_at is null
            or c.last_synced_at < ${buildCandidateThresholdExpression()} then 1
          when exists (
            select 1
            from alerts a
            left join payments p on p.id = a.payment_id
              and p.tenant_id = ${tenantId}
            left join subscriptions s on s.id = a.subscription_id
              and s.tenant_id = ${tenantId}
            left join customers alert_customer on alert_customer.id = a.customer_id
              and alert_customer.tenant_id = ${tenantId}
            where a.status = 'open'
              and (
                alert_customer.id = c.id
                or p.customer_id = c.id
                or s.customer_id = c.id
              )
          ) then 0
          else 2
        end as priority
      from customers c
      where c.mode = ${mode}
        and c.tenant_id = ${tenantId}
        and c.archived_at is null
        and c.mollie_customer_id is not null
        and (
          c.eboekhouden_link_status in ('needs_review', 'sync_error')
          or c.last_synced_at is null
          or c.last_synced_at < ${buildCandidateThresholdExpression()}
          or exists (
            select 1
            from alerts a
            left join payments p on p.id = a.payment_id
              and p.tenant_id = ${tenantId}
            left join subscriptions s on s.id = a.subscription_id
              and s.tenant_id = ${tenantId}
            left join customers alert_customer on alert_customer.id = a.customer_id
              and alert_customer.tenant_id = ${tenantId}
            where a.status = 'open'
              and (
                alert_customer.id = c.id
                or p.customer_id = c.id
                or s.customer_id = c.id
              )
          )
        )
      order by
        priority asc,
        coalesce(c.last_synced_at, 'epoch'::timestamptz) asc,
        c.created_at desc
      limit ${limit}
    `);

  return result.rows;
}

async function listPaymentCandidates(
  mode: MollieMode,
  limit: number,
  tenantId: string,
) {
  const result = await getDb().execute<PaymentCandidate>(sql`
      select
        p.id,
        p.mode,
        p.customer_id as "customerId",
        p.last_synced_at as "lastSyncedAt",
        case
          when p.recurring_collection_state in (
            'failed_needs_review',
            'mandate_problem_review',
            'reversal_critical_review'
          ) then 0
          when p.invoice_state in ('pending_invoice', 'invoice_failed') then 0
          when p.last_synced_at is null
            or p.last_synced_at < ${buildCandidateThresholdExpression()} then 1
          when exists (
            select 1
            from alerts a
            left join payments alert_payment on alert_payment.id = a.payment_id
              and alert_payment.tenant_id = ${tenantId}
            where a.payment_id = p.id
              and a.status = 'open'
              and alert_payment.id is not null
          ) then 0
          else 2
        end as priority
      from payments p
      where p.mode = ${mode}
        and p.tenant_id = ${tenantId}
        and p.mollie_payment_id is not null
        and (
          p.recurring_collection_state in (
            'failed_needs_review',
            'mandate_problem_review',
            'reversal_critical_review'
          )
          or p.invoice_state in ('pending_invoice', 'invoice_failed')
          or p.last_synced_at is null
          or p.last_synced_at < ${buildCandidateThresholdExpression()}
          or exists (
            select 1
            from alerts a
            left join payments alert_payment on alert_payment.id = a.payment_id
              and alert_payment.tenant_id = ${tenantId}
            where a.payment_id = p.id
              and a.status = 'open'
              and alert_payment.id is not null
          )
        )
      order by
        priority asc,
        coalesce(p.last_synced_at, 'epoch'::timestamptz) asc,
        p.created_at desc
      limit ${limit}
    `);

  return result.rows;
}

async function listSubscriptionCandidates(
  mode: MollieMode,
  limit: number,
  tenantId: string,
) {
  const result = await getDb().execute<SubscriptionCandidate>(sql`
      select
        s.id,
        s.mode,
        s.customer_id as "customerId",
        s.local_status as "localStatus",
        s.last_synced_at as "lastSyncedAt",
        case
          when s.local_status in ('payment_action_required', 'out_of_sync') then 0
          when s.last_synced_at is null
            or s.last_synced_at < ${buildCandidateThresholdExpression()} then 1
          when exists (
            select 1
            from alerts a
            left join subscriptions alert_subscription on alert_subscription.id = a.subscription_id
              and alert_subscription.tenant_id = ${tenantId}
            where a.subscription_id = s.id
              and a.status = 'open'
              and alert_subscription.id is not null
          ) then 0
          else 2
        end as priority
      from subscriptions s
      where s.mode = ${mode}
        and s.tenant_id = ${tenantId}
        and s.mollie_subscription_id is not null
        and (
          s.local_status in ('payment_action_required', 'out_of_sync')
          or s.last_synced_at is null
          or s.last_synced_at < ${buildCandidateThresholdExpression()}
          or exists (
            select 1
            from alerts a
            left join subscriptions alert_subscription on alert_subscription.id = a.subscription_id
              and alert_subscription.tenant_id = ${tenantId}
            where a.subscription_id = s.id
              and a.status = 'open'
              and alert_subscription.id is not null
          )
        )
      order by
        priority asc,
        coalesce(s.last_synced_at, 'epoch'::timestamptz) asc,
        s.created_at desc
      limit ${limit}
    `);

  return result.rows;
}

export async function repairCustomerTarget(input: {
  actor?: RepairActor;
  customerId: string;
  mode: MollieMode;
  tenantId: string;
}): Promise<RepairTargetResult> {
  const result = await repairCustomerBillingState({
    actor: input.actor,
    customerId: input.customerId,
    mode: input.mode,
  });

  return {
    id: result.customerId,
    kind: "customer",
    reason: result.reason,
    status: result.status,
  };
}

export async function repairReliabilityTarget(input: {
  actor?: RepairActor;
  id: string;
  kind: RepairTargetKind;
  mode: MollieMode;
  tenantId: string;
}): Promise<RepairTargetResult> {
  if (input.kind === "customer") {
    return repairCustomerTarget({
      actor: input.actor,
      customerId: input.id,
      tenantId: input.tenantId,
      mode: input.mode,
    });
  }

  if (input.kind === "payment") {
    return repairPaymentTarget({
      actor: input.actor,
      mode: input.mode,
      paymentId: input.id,
      tenantId: input.tenantId,
    });
  }

  return repairSubscriptionTarget({
    actor: input.actor,
    mode: input.mode,
    subscriptionId: input.id,
    tenantId: input.tenantId,
  });
}

export async function repairPaymentTarget(input: {
  actor?: RepairActor;
  paymentId: string;
  mode: MollieMode;
  tenantId: string;
}): Promise<RepairTargetResult> {
  const payment = await getDb().execute<LocalPaymentLookup>(sql`
      select
        id,
        mode,
        mollie_payment_id as "molliePaymentId"
      from payments
      where id = ${input.paymentId}
        and mode = ${input.mode}
        and tenant_id = ${input.tenantId}
      limit 1
    `);
  const row = payment.rows[0];

  if (!row) {
    return {
      id: input.paymentId,
      kind: "payment",
      reason: "missing_payment",
      status: "skipped",
    };
  }

  if (!row.molliePaymentId) {
    return {
      id: row.id,
      kind: "payment",
      reason: "not_linked",
      status: "skipped",
    };
  }

  await syncPaymentByMollieId(row.molliePaymentId, {
    actor: input.actor,
    preferredMode: row.mode,
    strictMode: true,
    tenantId: input.tenantId,
  });

  return {
    id: row.id,
    kind: "payment",
    status: "repaired",
  };
}

export async function repairSubscriptionTarget(input: {
  actor?: RepairActor;
  subscriptionId: string;
  mode: MollieMode;
  tenantId: string;
}): Promise<RepairTargetResult> {
  const subscription = await getDb().execute<LocalSubscriptionLookup>(sql`
      select
        id,
        mode,
        mollie_subscription_id as "mollieSubscriptionId"
      from subscriptions
      where id = ${input.subscriptionId}
        and mode = ${input.mode}
        and tenant_id = ${input.tenantId}
      limit 1
    `);
  const row = subscription.rows[0];

  if (!row) {
    return {
      id: input.subscriptionId,
      kind: "subscription",
      reason: "missing_subscription",
      status: "skipped",
    };
  }

  if (!row.mollieSubscriptionId) {
    return {
      id: row.id,
      kind: "subscription",
      reason: "not_linked",
      status: "skipped",
    };
  }

  await syncSubscriptionByMollieId(row.mollieSubscriptionId, {
    actor: input.actor,
    preferredMode: row.mode,
    strictMode: true,
    tenantId: input.tenantId,
  });

  return {
    id: row.id,
    kind: "subscription",
    status: "repaired",
  };
}

export async function repairWebhookEventsBatch(input: {
  actor?: RepairActor;
  limit: number;
  mode: MollieMode;
  tenantId: string;
}) {
  const actor = input.actor ?? {
    kind: "system" as const,
  };
  const limit = normalizeLimit(input.limit);
  const candidates = await listFailedWebhookCandidatesForTenant(
    input.mode,
    limit,
    input.tenantId,
  );

  let repairedCount = 0;
  let skippedCount = 0;

  for (const candidate of candidates) {
    if (!candidate.resourceId) {
      skippedCount += 1;
      continue;
    }

    try {
      await processWebhookResource(
        candidate.resourceId,
        candidate.mode,
        actor,
        input.tenantId,
      );
      await updateWebhookEventStatus({
        id: candidate.id,
        processed: true,
        tenantId: input.tenantId,
      });
      repairedCount += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Webhook repair failed.";
      await updateWebhookEventStatus({
        errorMessage: message,
        id: candidate.id,
        processed: false,
        tenantId: input.tenantId,
      });
      skippedCount += 1;
    }
  }

  const result = {
    repairedCount,
    skippedCount,
    totalChecked: candidates.length,
  };

  await writeAuditLog(
    {
      action: "repair.webhook_batch",
      details: result,
      entityId: input.mode,
      entityType: "webhook_repair_batch",
      mode: input.mode,
      outcome: repairedCount > 0 ? "success" : "failure",
      summary: "Processed a bounded repair batch for failed Mollie webhook events.",
    },
    undefined,
    actor,
  );

  return result;
}

export async function repairStaleRecordsBatch(input: {
  actor?: RepairActor;
  limit: number;
  mode: MollieMode;
  tenantId: string;
}): Promise<RepairBatchResult> {
  const actor = input.actor ?? {
    kind: "system" as const,
  };
  const limit = normalizeLimit(input.limit);
  const [customerRows, paymentRows, subscriptionRows] = await Promise.all([
    listCustomerCandidates(input.mode, limit, input.tenantId),
    listPaymentCandidates(input.mode, limit, input.tenantId),
    listSubscriptionCandidates(input.mode, limit, input.tenantId),
  ]);

  const candidates = [
    ...customerRows.map((row) => ({
      id: row.id,
      kind: "customer" as const,
      lastSyncedAt: row.lastSyncedAt,
      priority: row.priority,
    })),
    ...paymentRows.map((row) => ({
      id: row.id,
      kind: "payment" as const,
      customerId: row.customerId,
      lastSyncedAt: row.lastSyncedAt,
      priority: row.priority,
    })),
    ...subscriptionRows.map((row) => ({
      id: row.id,
      kind: "subscription" as const,
      customerId: row.customerId,
      lastSyncedAt: row.lastSyncedAt,
      priority: row.priority,
    })),
  ].sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }

    return toMillis(left.lastSyncedAt) - toMillis(right.lastSyncedAt);
  });

  let repairedCount = 0;
  let skippedCount = 0;
  const repairedCustomerIds = new Set<string>();

  for (const candidate of candidates.slice(0, limit)) {
    if (candidate.kind === "customer") {
      const result = await repairCustomerTarget({
        actor,
        customerId: candidate.id,
        tenantId: input.tenantId,
        mode: input.mode,
      });

      if (result.status === "repaired") {
        repairedCount += 1;
        repairedCustomerIds.add(result.id);
      } else {
        skippedCount += 1;
      }

      continue;
    }

    if (candidate.kind === "payment") {
      if (candidate.customerId && repairedCustomerIds.has(candidate.customerId)) {
        skippedCount += 1;
        continue;
      }

      const result = await repairPaymentTarget({
        actor,
        mode: input.mode,
        paymentId: candidate.id,
        tenantId: input.tenantId,
      });

      if (result.status === "repaired") {
        repairedCount += 1;
      } else {
        skippedCount += 1;
      }

      continue;
    }

    if (repairedCustomerIds.has(candidate.customerId)) {
      skippedCount += 1;
      continue;
    }

    const result = await repairSubscriptionTarget({
      actor,
      mode: input.mode,
      subscriptionId: candidate.id,
      tenantId: input.tenantId,
    });

    if (result.status === "repaired") {
      repairedCount += 1;
    } else {
      skippedCount += 1;
    }
  }

  const batchResult: RepairBatchResult = {
    customersChecked: customerRows.length,
    paymentsChecked: paymentRows.length,
    repairedCount,
    skippedCount,
    subscriptionsChecked: subscriptionRows.length,
    totalChecked: candidates.slice(0, limit).length,
  };

  await writeAuditLog(
    {
      action: "repair.stale_batch",
      details: batchResult,
      entityId: input.mode,
      entityType: "repair_batch",
      mode: input.mode,
      outcome: repairedCount > 0 ? "success" : "failure",
      summary: "Processed a bounded repair batch for stale Mollie records.",
    },
    undefined,
    actor,
  );

  return batchResult;
}
