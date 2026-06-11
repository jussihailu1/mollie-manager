import "server-only";

import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import {
  billingSettingsAreComplete,
  getTenantBillingSettings,
  type TenantBillingSettings,
} from "@/lib/billing-settings";
import { getDb, transaction, type DbClient } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import {
  createEboekhoudenInvoice,
  type EboekhoudenInvoice,
} from "@/lib/eboekhouden/client";
import {
  isSafeInvoiceRetryFailure,
  SAFE_INVOICE_RETRY_FAILURE_CODES,
} from "@/lib/eboekhouden/invoice-failure-retry";
import {
  isEboekhoudenReferenceAlreadyExistsError,
  serializeInvoiceErrorMessage,
  toInvoiceAmountNumber,
  toInvoiceCount,
  toInvoiceDateString,
} from "@/lib/eboekhouden/invoice-flow-helpers";
import { buildFirstPaymentInvoiceReference } from "@/lib/eboekhouden/invoice-reference";
import {
  buildDeterministicMatchCte,
  buildFirstPaymentFilter,
} from "@/lib/eboekhouden/first-payment-invoice-match-query";
import { findExistingEboekhoudenInvoiceByReference } from "@/lib/eboekhouden/invoice-reconcile";
import { buildInvoiceRetryQueuedMetadata } from "@/lib/eboekhouden/invoice-retry-metadata";
import {
  buildInvoiceCreationClaimMetadata,
  buildInvoiceCreationFailureMetadata,
  buildInvoiceCreationSuccessMetadata,
} from "@/lib/eboekhouden/invoice-creation-metadata";
import { filterSafeFailedInvoiceRetryIds } from "@/lib/eboekhouden/invoice-retry-candidates";
import { countSafeInvoiceRetryFailures } from "@/lib/eboekhouden/invoice-retry-summary";
import { createInvoiceBatchWithDependencies } from "@/lib/invoice-creation-batch";
import { deliverCustomerInvoiceEmail } from "@/lib/invoice-delivery";
import { notificationsAreConfigured } from "@/lib/notifications/email";
import { deliverAlertEmail, openAlert } from "@/lib/reliability/alerts";
import { subscriptionConsentPlanSnapshotSchema } from "@/lib/subscription-consent";

const DEFAULT_BATCH_SIZE = 25;
const TERMINAL_OR_IN_PROGRESS_STATES = [
  "invoice_creating",
  "invoice_created",
  "invoice_failed",
  "invoice_sent",
] as const;

type InvoiceActor = {
  email?: string | null;
  kind: "system" | "user";
};

type FirstPaymentInvoiceCandidate = {
  amountValue: string;
  consentAcceptedAt: string | null;
  consentId: string;
  customerEmail: string | null;
  customerId: string | null;
  eboekhoudenRelationId: number | null;
  firstPaymentMode: "mandate_only" | "real_installment";
  mode: MollieMode;
  molliePaymentId: string | null;
  paidAt: string | null;
  paymentCreatedAt: string;
  paymentId: string;
  paymentLinkId: string;
  planSnapshot: unknown;
  subscriptionId: string | null;
};

type DueFirstPaymentInvoiceQueueSummary = {
  actionableCount: number;
  blockedCount: number;
  dueCount: number;
};

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

type AlertResult = {
  id: string;
  isNew: boolean;
};

type CreateFirstPaymentInvoiceResult =
  | {
      invoiceId: string | null;
      invoiceNumber: string | null;
      paymentId: string;
      status: "created";
    }
  | {
      paymentId: string;
      reason: string;
      status: "failed" | "skipped";
    };

type FailedFirstPaymentRecoveryCandidate = {
  customerEmail: string | null;
  customerId: string | null;
  eboekhoudenRelationId: number;
  mode: MollieMode;
  paidAt: string | null;
  paymentCreatedAt: string;
  paymentId: string;
  subscriptionId: string | null;
};

function serializeErrorMessage(error: unknown) {
  return serializeInvoiceErrorMessage(
    error,
    "First-payment invoice creation failed.",
  );
}

function buildReference(candidate: FirstPaymentInvoiceCandidate) {
  return buildFirstPaymentInvoiceReference({
    invoiceDate:
      toInvoiceDateString(candidate.paidAt) ??
      toInvoiceDateString(candidate.paymentCreatedAt),
    paymentId: candidate.paymentId,
  });
}

async function getFirstPaymentInvoiceCandidate(paymentId: string) {
  const result = await getDb().execute<FirstPaymentInvoiceCandidate>(sql`
    ${buildDeterministicMatchCte({ paymentId })}
    select
      p.id as "paymentId",
      p.mode,
      p.customer_id as "customerId",
      p.subscription_id as "subscriptionId",
      p.mollie_payment_id as "molliePaymentId",
      p.paid_at as "paidAt",
      p.created_at as "paymentCreatedAt",
      p.amount_value::text as "amountValue",
      c.email as "customerEmail",
      c.eboekhouden_relation_id as "eboekhoudenRelationId",
      dm.first_payment_mode as "firstPaymentMode",
      dm.payment_link_id as "paymentLinkId",
      dm.consent_id as "consentId",
      dm.consent_accepted_at as "consentAcceptedAt",
      dm.plan_snapshot as "planSnapshot"
    from payments p
    inner join deterministic_matches dm on dm.payment_id = p.id
    left join customers c on c.id = p.customer_id and c.mode = p.mode
    where p.id = ${paymentId}
    limit 1
  `);

  return result.rows[0] ?? null;
}

async function claimPaymentForInvoice(input: {
  actor: InvoiceActor;
  mode: MollieMode;
  paymentId: string;
}) {
  const result = await getDb().execute<{ id: string }>(sql`
    update payments
    set
      invoice_state = 'invoice_creating',
      invoice_failed_at = null,
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(
        buildInvoiceCreationClaimMetadata({
          actorEmail: input.actor.email,
        }),
      )}::jsonb
    where id = ${input.paymentId}
      and mode = ${input.mode}
      and payment_type = 'first'
      and mollie_status = 'paid'
      and invoice_state = 'pending_invoice'
      and eboekhouden_invoice_id is null
      and eboekhouden_invoice_number is null
    returning id
  `);

  return result.rows[0]?.id ?? null;
}

async function storeInvoiceCreationSuccess(input: {
  actor: InvoiceActor;
  candidate: FirstPaymentInvoiceCandidate;
  invoice: EboekhoudenInvoice;
  source?: "created" | "reconciled_existing";
}) {
  const invoiceId = input.invoice.id ? String(input.invoice.id) : null;
  const invoiceNumber = input.invoice.invoiceNumber ?? input.invoice.number ?? null;
  const source = input.source ?? "created";
  const alertResult = await transaction<AlertResult>(async (tx) => {
    await tx.execute(sql`
      update payments
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
      where id = ${input.candidate.paymentId}
        and invoice_state = 'invoice_creating'
    `);

    await writeAuditLog(
      {
        action: "first_payment_invoice.create",
        details: {
          consentId: input.candidate.consentId,
          eboekhoudenInvoiceId: invoiceId,
          eboekhoudenInvoiceNumber: invoiceNumber,
          source,
          molliePaymentId: input.candidate.molliePaymentId,
          paymentId: input.candidate.paymentId,
          paymentLinkId: input.candidate.paymentLinkId,
        },
        entityId: input.candidate.paymentId,
        entityType: "payment",
        mode: input.candidate.mode,
        outcome: "success",
        summary:
          source === "created"
            ? "Created an e-Boekhouden invoice for a paid first payment."
            : "Recovered an existing e-Boekhouden invoice for a paid first payment.",
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
        and payment_id = ${input.candidate.paymentId}
        and payload ->> 'kind' = 'first_payment_invoice_creation_failed'
    `);

    return openAlert(
      {
        customerId: input.candidate.customerId,
        message:
          source === "created"
            ? `Created e-Boekhouden invoice ${invoiceNumber ?? invoiceId ?? "without returned number"} for the paid first payment ${input.candidate.paymentId}.`
            : `Recovered existing e-Boekhouden invoice ${invoiceNumber ?? invoiceId ?? "without returned number"} for the paid first payment ${input.candidate.paymentId}.`,
        paymentId: input.candidate.paymentId,
        payload: {
          consentId: input.candidate.consentId,
          eboekhoudenInvoiceId: invoiceId,
          eboekhoudenInvoiceNumber: invoiceNumber,
          kind: "first_payment_invoice_created",
          mode: input.candidate.mode,
          paymentId: input.candidate.paymentId,
          source,
        },
        severity: "info",
        subscriptionId: input.candidate.subscriptionId,
        title:
          source === "created"
            ? "First-payment invoice created"
            : "First-payment invoice recovered",
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
  candidate: FirstPaymentInvoiceCandidate;
  error: unknown;
}) {
  const errorMessage = serializeErrorMessage(input.error);
  const alertResult = await transaction<AlertResult>(async (tx) => {
    await tx.execute(sql`
      update payments
      set
        invoice_state = 'invoice_failed',
        invoice_failed_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(
          buildInvoiceCreationFailureMetadata({ errorMessage }),
        )}::jsonb,
        updated_at = now()
      where id = ${input.candidate.paymentId}
        and invoice_state = 'invoice_creating'
    `);

    await writeAuditLog(
      {
        action: "first_payment_invoice.create",
        details: {
          consentId: input.candidate.consentId,
          error: errorMessage,
          molliePaymentId: input.candidate.molliePaymentId,
          paymentId: input.candidate.paymentId,
          paymentLinkId: input.candidate.paymentLinkId,
        },
        entityId: input.candidate.paymentId,
        entityType: "payment",
        mode: input.candidate.mode,
        outcome: "failure",
        summary: "First-payment invoice creation failed for a paid first payment.",
      },
      tx,
      input.actor,
    );

    return openAlert(
      {
        customerId: input.candidate.customerId,
        message: "Could not create the first-payment e-Boekhouden invoice. Review the payment before retrying so a duplicate invoice is not created upstream.",
        paymentId: input.candidate.paymentId,
        payload: {
          consentId: input.candidate.consentId,
          error: errorMessage,
          kind: "first_payment_invoice_creation_failed",
          mode: input.candidate.mode,
          paymentId: input.candidate.paymentId,
        },
        severity: "warning",
        subscriptionId: input.candidate.subscriptionId,
        title: "First-payment invoice creation failed",
      },
      tx,
    );
  });

  if (alertResult.isNew && notificationsAreConfigured()) {
    await deliverAlertEmail({
      alertId: alertResult.id,
      message: [
        "First-payment e-Boekhouden invoice creation failed.",
        "",
        `Customer email: ${input.candidate.customerEmail ?? "unknown"}`,
        `Payment: ${input.candidate.paymentId}`,
        `Mollie payment: ${input.candidate.molliePaymentId ?? "unknown"}`,
        `Consent: ${input.candidate.consentId}`,
        `Error: ${errorMessage}`,
      ].join("\n"),
      title: "First-payment invoice creation failed",
    });
  }

  return errorMessage;
}

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

async function listFailedFirstPaymentRecoveryCandidates(
  mode: MollieMode,
  limit: number,
) {
  const result = await getDb().execute<FailedFirstPaymentRecoveryCandidate>(sql`
    ${buildDeterministicMatchCte({ mode })}
    select
      p.id as "paymentId",
      p.mode,
      p.customer_id as "customerId",
      p.subscription_id as "subscriptionId",
      p.paid_at as "paidAt",
      p.created_at as "paymentCreatedAt",
      c.email as "customerEmail",
      c.eboekhouden_relation_id as "eboekhoudenRelationId"
    from payments p
    inner join deterministic_matches dm on dm.payment_id = p.id
    inner join customers c on c.id = p.customer_id and c.mode = p.mode
    where p.mode = ${mode}
      and p.payment_type = 'first'
      and p.invoice_state = 'invoice_failed'
      and p.eboekhouden_invoice_id is null
      and p.eboekhouden_invoice_number is null
      and c.eboekhouden_relation_id is not null
    order by p.updated_at asc, p.created_at asc
    limit ${Math.max(1, limit)}
  `);

  return result.rows;
}

async function storeRecoveredFailedFirstPaymentSuccess(input: {
  actor: InvoiceActor;
  candidate: FailedFirstPaymentRecoveryCandidate;
  invoice: EboekhoudenInvoice;
}) {
  const invoiceId = input.invoice.id ? String(input.invoice.id) : null;
  const invoiceNumber = input.invoice.invoiceNumber ?? input.invoice.number ?? null;
  const result = await getDb().execute<{ id: string }>(sql`
    update payments
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
    where id = ${input.candidate.paymentId}
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
      action: "first_payment_invoice.recover_failed",
      details: {
        eboekhoudenInvoiceId: invoiceId,
        eboekhoudenInvoiceNumber: invoiceNumber,
        paymentId: input.candidate.paymentId,
        source: "reconciled_existing",
      },
      entityId: input.candidate.paymentId,
      entityType: "payment",
      mode: input.candidate.mode,
      outcome: "success",
      summary:
        "Recovered failed first-payment invoice row by reconciling existing e-Boekhouden invoice.",
    },
    undefined,
    input.actor,
  );

  return {
    invoiceId,
    invoiceNumber,
  };
}

async function listDueFirstPaymentInvoiceCandidates(
  mode: MollieMode,
  limit = DEFAULT_BATCH_SIZE,
) {
  const result = await getDb().execute<FirstPaymentInvoiceCandidate>(sql`
    ${buildDeterministicMatchCte({ mode })}
    select
      p.id as "paymentId",
      p.mode,
      p.customer_id as "customerId",
      p.subscription_id as "subscriptionId",
      p.mollie_payment_id as "molliePaymentId",
      p.paid_at as "paidAt",
      p.created_at as "paymentCreatedAt",
      p.amount_value::text as "amountValue",
      c.email as "customerEmail",
      c.eboekhouden_relation_id as "eboekhoudenRelationId",
      dm.first_payment_mode as "firstPaymentMode",
      dm.payment_link_id as "paymentLinkId",
      dm.consent_id as "consentId",
      dm.consent_accepted_at as "consentAcceptedAt",
      dm.plan_snapshot as "planSnapshot"
    from payments p
    inner join deterministic_matches dm on dm.payment_id = p.id
    left join customers c on c.id = p.customer_id and c.mode = p.mode
    where p.mode = ${mode}
      and p.payment_type = 'first'
      and p.mollie_status = 'paid'
      and dm.consent_accepted_at is not null
      and dm.first_payment_mode = 'real_installment'
      and c.eboekhouden_relation_id is not null
      and p.invoice_state = 'pending_invoice'
      and p.eboekhouden_invoice_id is null
      and p.eboekhouden_invoice_number is null
    order by coalesce(p.paid_at, p.created_at) asc, p.created_at asc
    limit ${Math.max(1, limit)}
  `);

  return result.rows;
}

export async function normalizeFirstPaymentInvoiceStates(input?: {
  client?: DbClient;
  mode?: MollieMode;
  paymentId?: string;
}) {
  const db = input?.client ?? getDb();
  const filters = buildFirstPaymentFilter({
    mode: input?.mode,
    paymentId: input?.paymentId,
  });
  const result = await db.execute<{ id: string }>(sql`
    ${buildDeterministicMatchCte({
      mode: input?.mode,
      paymentId: input?.paymentId,
    })}
    , normalized_targets as (
      select
        p.id as payment_id,
        case
          when dm.payment_id is not null
            and dm.consent_accepted_at is not null
            and dm.first_payment_mode = 'mandate_only'
          then 'skipped'::payment_invoice_state
          when dm.payment_id is not null
            and dm.consent_accepted_at is not null
            and dm.first_payment_mode = 'real_installment'
            and p.mollie_status = 'paid'
          then 'pending_invoice'::payment_invoice_state
          else 'not_applicable'::payment_invoice_state
        end as invoice_state
      from payments p
      left join deterministic_matches dm on dm.payment_id = p.id
      where ${filters}
    )
    update payments p
    set
      invoice_state = nt.invoice_state,
      updated_at = now()
    from normalized_targets nt
    where p.id = nt.payment_id
      and p.invoice_state not in (
        ${TERMINAL_OR_IN_PROGRESS_STATES[0]},
        ${TERMINAL_OR_IN_PROGRESS_STATES[1]},
        ${TERMINAL_OR_IN_PROGRESS_STATES[2]},
        ${TERMINAL_OR_IN_PROGRESS_STATES[3]}
      )
      and p.invoice_state is distinct from nt.invoice_state
    returning p.id as id
  `);

  return result.rows.length;
}

export async function getDueFirstPaymentInvoiceQueueSummary(
  mode: MollieMode,
): Promise<DueFirstPaymentInvoiceQueueSummary> {
  const result = await getDb().execute<{
    actionableCount: number | string;
    blockedCount: number | string;
    dueCount: number | string;
  }>(sql`
    ${buildDeterministicMatchCte({ mode })}
    select
      count(*) filter (where c.eboekhouden_relation_id is not null) as "actionableCount",
      count(*) filter (where c.eboekhouden_relation_id is null) as "blockedCount",
      count(*) as "dueCount"
    from payments p
    inner join deterministic_matches dm on dm.payment_id = p.id
    left join customers c on c.id = p.customer_id and c.mode = p.mode
    where p.mode = ${mode}
      and p.payment_type = 'first'
      and p.mollie_status = 'paid'
      and dm.consent_accepted_at is not null
      and dm.first_payment_mode = 'real_installment'
      and p.eboekhouden_invoice_id is null
      and p.eboekhouden_invoice_number is null
      and p.invoice_state not in (
        ${TERMINAL_OR_IN_PROGRESS_STATES[0]},
        ${TERMINAL_OR_IN_PROGRESS_STATES[1]},
        ${TERMINAL_OR_IN_PROGRESS_STATES[2]},
        ${TERMINAL_OR_IN_PROGRESS_STATES[3]}
      )
  `);
  const row = result.rows[0];

  return {
    actionableCount: toInvoiceCount(row?.actionableCount),
    blockedCount: toInvoiceCount(row?.blockedCount),
    dueCount: toInvoiceCount(row?.dueCount),
  };
}

export async function createEboekhoudenInvoiceForFirstPayment(
  paymentId: string,
  options?: {
    actor?: InvoiceActor;
    settings?: TenantBillingSettings | null;
  },
): Promise<CreateFirstPaymentInvoiceResult> {
  const actor = options?.actor ?? {
    kind: "system",
  };
  const [settings, candidate] = await Promise.all([
    options?.settings ? Promise.resolve(options.settings) : getTenantBillingSettings(),
    getFirstPaymentInvoiceCandidate(paymentId),
  ]);

  if (!billingSettingsAreComplete(settings)) {
    throw new Error(
      "Tenant billing settings are incomplete. Select an invoice template and revenue ledger first.",
    );
  }

  if (!candidate) {
    return {
      paymentId,
      reason: "First payment was not found or did not match a deterministic accepted onboarding consent.",
      status: "skipped",
    };
  }

  if (!candidate.eboekhoudenRelationId) {
    return {
      paymentId,
      reason:
        "Customer is not linked to an e-Boekhouden relation. Link the customer before creating the invoice.",
      status: "skipped",
    };
  }

  if (!candidate.consentAcceptedAt) {
    return {
      paymentId,
      reason: "The matched onboarding consent is not accepted yet.",
      status: "skipped",
    };
  }

  if (candidate.firstPaymentMode !== "real_installment") {
    return {
      paymentId,
      reason: "Mandate-only first payments must not create a normal invoice.",
      status: "skipped",
    };
  }

  const claimedPaymentId = await claimPaymentForInvoice({
    actor,
    mode: candidate.mode,
    paymentId,
  });

  if (!claimedPaymentId) {
    return {
      paymentId,
      reason: "Payment row was already claimed, already invoiced, or is no longer pending invoice creation.",
      status: "skipped",
    };
  }

  const invoiceDate =
    toInvoiceDateString(candidate.paidAt) ??
    toInvoiceDateString(candidate.paymentCreatedAt);
  if (!invoiceDate) {
    const errorMessage = await storeInvoiceCreationFailure({
      actor,
      candidate,
      error: new Error("Could not derive the invoice date for the paid first payment."),
    });

    return {
      paymentId,
      reason: errorMessage,
      status: "failed",
    };
  }
  const reference = buildReference(candidate);

  try {
    const existing = await findExistingEboekhoudenInvoiceByReference({
      date: invoiceDate,
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
        entityId: candidate.paymentId,
        invoiceType: "first_payment",
        mode: candidate.mode,
        subscriptionId: candidate.subscriptionId,
      });

      return {
        invoiceId: storedRecoveredInvoice.invoiceId,
        invoiceNumber: storedRecoveredInvoice.invoiceNumber,
        paymentId,
        status: "created",
      };
    }

    const parsedPlanSnapshot = subscriptionConsentPlanSnapshotSchema.safeParse(
      candidate.planSnapshot,
    );

    if (!parsedPlanSnapshot.success) {
      throw new Error("Stored onboarding consent snapshot is invalid.");
    }

    const invoice = await createEboekhoudenInvoice({
      date: invoiceDate,
      inExVat: "EX",
      items: [
        {
          description: parsedPlanSnapshot.data.description,
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
      termOfPayment: 0,
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
      entityId: candidate.paymentId,
      invoiceType: "first_payment",
      mode: candidate.mode,
      subscriptionId: candidate.subscriptionId,
    });

    return {
      invoiceId: storedInvoice.invoiceId,
      invoiceNumber: storedInvoice.invoiceNumber,
      paymentId,
      status: "created",
    };
  } catch (error) {
    if (isEboekhoudenReferenceAlreadyExistsError(error)) {
      const existing = await findExistingEboekhoudenInvoiceByReference({
        date: invoiceDate,
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
          entityId: candidate.paymentId,
          invoiceType: "first_payment",
          mode: candidate.mode,
          subscriptionId: candidate.subscriptionId,
        });

        return {
          invoiceId: storedRecoveredInvoice.invoiceId,
          invoiceNumber: storedRecoveredInvoice.invoiceNumber,
          paymentId,
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
      paymentId,
      reason: errorMessage,
      status: "failed",
    };
  }
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

  await normalizeFirstPaymentInvoiceStates({
    mode: input.mode,
  });

  return createInvoiceBatchWithDependencies(input, {
    createInvoice: async (entityId) =>
      createEboekhoudenInvoiceForFirstPayment(entityId, {
        actor: input.actor,
        settings,
      }),
    getRemainingSummary: getDueFirstPaymentInvoiceQueueSummary,
    loadCandidates: async (mode, limit) =>
      (await listDueFirstPaymentInvoiceCandidates(mode, limit)).map((row) => ({
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
    const invoiceDate =
      toInvoiceDateString(candidate.paidAt) ??
      toInvoiceDateString(candidate.paymentCreatedAt);
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
    await deliverCustomerInvoiceEmail({
      actor: input.actor,
      customerEmail: candidate.customerEmail,
      customerId: candidate.customerId,
      eboekhoudenInvoiceId: recovered.invoiceId,
      eboekhoudenInvoiceNumber: recovered.invoiceNumber,
      eboekhoudenInvoicePdfUrl: existing.invoice.urlPdfFile ?? null,
      entityId: candidate.paymentId,
      invoiceType: "first_payment",
      mode: candidate.mode,
      subscriptionId: candidate.subscriptionId,
    });
  }

  return {
    ambiguousCount,
    recoveredCount,
    scannedCount: candidates.length,
  };
}
