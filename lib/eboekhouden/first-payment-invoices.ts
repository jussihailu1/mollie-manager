import "server-only";

import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import {
  billingSettingsAreComplete,
  getTenantBillingSettings,
  type TenantBillingSettings,
} from "@/lib/billing-settings";
import { getDb, transaction } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import { createEboekhoudenInvoice } from "@/lib/eboekhouden/client";
import {
  isSafeInvoiceRetryFailure,
  SAFE_INVOICE_RETRY_FAILURE_CODES,
} from "@/lib/eboekhouden/invoice-failure-retry";
import {
  isEboekhoudenReferenceAlreadyExistsError,
  toInvoiceAmountNumber,
} from "@/lib/eboekhouden/invoice-flow-helpers";
import { buildFirstPaymentInvoiceReference } from "@/lib/eboekhouden/invoice-reference";
import { buildDeterministicMatchCte } from "@/lib/eboekhouden/first-payment-invoice-match-query";
import {
  describeFirstPaymentInvoiceEligibility,
} from "@/lib/eboekhouden/first-payment-invoice-eligibility";
import { buildFirstPaymentInvoiceDelivery } from "@/lib/eboekhouden/first-payment-invoice-delivery";
import {
  claimFirstPaymentInvoiceForCreation,
  storeFirstPaymentInvoiceCreationFailure,
  storeFirstPaymentInvoiceCreationSuccess,
  type FirstPaymentInvoiceActor,
} from "@/lib/eboekhouden/first-payment-invoice-persistence";
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
import { subscriptionConsentPlanSnapshotSchema } from "@/lib/subscription-consent";

export {
  getDueFirstPaymentInvoiceQueueSummaryImpl as getDueFirstPaymentInvoiceQueueSummary,
  listDueFirstPaymentInvoiceCandidatesImpl as listDueFirstPaymentInvoiceCandidates,
  normalizeFirstPaymentInvoiceStatesImpl as normalizeFirstPaymentInvoiceStates,
};

const DEFAULT_BATCH_SIZE = 25;

type InvoiceActor = FirstPaymentInvoiceActor;

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

function buildReference(candidate: FirstPaymentInvoiceCandidate) {
  return buildFirstPaymentInvoiceReference({
    invoiceDate: resolveFirstPaymentInvoiceDate({
      paidAt: candidate.paidAt,
      paymentCreatedAt: candidate.paymentCreatedAt,
    }),
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

  const eligibility = describeFirstPaymentInvoiceEligibility(
    candidate
      ? {
          consentAcceptedAt: candidate.consentAcceptedAt,
          eboekhoudenRelationId: candidate.eboekhoudenRelationId,
          firstPaymentMode: candidate.firstPaymentMode,
        }
      : null,
  );

  if (eligibility.status === "skipped") {
    return {
      paymentId,
      reason: eligibility.reason,
      status: "skipped",
    };
  }
  const eligibleCandidate = eligibility.candidate;

  const claimedPaymentId = await claimFirstPaymentInvoiceForCreation({
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

  const invoiceDate = resolveFirstPaymentInvoiceDate({
    paidAt: candidate.paidAt,
    paymentCreatedAt: candidate.paymentCreatedAt,
  });
  if (!invoiceDate) {
    const failure = await storeFirstPaymentInvoiceCreationFailure({
      actor,
      candidate,
      error: new Error("Could not derive the invoice date for the paid first payment."),
    });

    return {
      paymentId,
      reason: failure.errorMessage,
      status: "failed",
    };
  }
  const reference = buildReference(candidate);

  try {
    const existing = await findExistingEboekhoudenInvoiceByReference({
      date: invoiceDate,
      reference,
      relationId: eligibleCandidate.eboekhoudenRelationId,
    });

    if (existing.status === "ambiguous") {
      throw new Error(
        `Ambiguous e-Boekhouden invoice match for reference ${reference}; manual review required.`,
      );
    }

    if (existing.status === "found") {
      const storedRecoveredInvoice = await storeFirstPaymentInvoiceCreationSuccess({
        actor,
        candidate,
        invoice: existing.invoice,
        source: "reconciled_existing",
      });
      await deliverCustomerInvoiceEmail(
        buildFirstPaymentInvoiceDelivery({
          actor,
          customerEmail: candidate.customerEmail,
          customerId: candidate.customerId,
          eboekhoudenInvoiceId: storedRecoveredInvoice.invoiceId,
          eboekhoudenInvoiceNumber: storedRecoveredInvoice.invoiceNumber,
          eboekhoudenInvoicePdfUrl: existing.invoice.urlPdfFile ?? null,
          entityId: candidate.paymentId,
          mode: candidate.mode,
          subscriptionId: candidate.subscriptionId,
        }),
      );

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
      relationId: eligibleCandidate.eboekhoudenRelationId,
      templateId: settings!.invoiceTemplateId!,
      termOfPayment: 0,
    });
    const storedInvoice = await storeFirstPaymentInvoiceCreationSuccess({
      actor,
      candidate,
      invoice,
    });
    await deliverCustomerInvoiceEmail(
      buildFirstPaymentInvoiceDelivery({
        actor,
        customerEmail: candidate.customerEmail,
        customerId: candidate.customerId,
        eboekhoudenInvoiceId: storedInvoice.invoiceId,
        eboekhoudenInvoiceNumber: storedInvoice.invoiceNumber,
        eboekhoudenInvoicePdfUrl: invoice.urlPdfFile ?? null,
        entityId: candidate.paymentId,
        mode: candidate.mode,
        subscriptionId: candidate.subscriptionId,
      }),
    );

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
        relationId: eligibleCandidate.eboekhoudenRelationId,
      });

      if (existing.status === "found") {
        const storedRecoveredInvoice = await storeFirstPaymentInvoiceCreationSuccess({
          actor,
          candidate,
          invoice: existing.invoice,
          source: "reconciled_existing",
        });
        await deliverCustomerInvoiceEmail(
          buildFirstPaymentInvoiceDelivery({
            actor,
            customerEmail: candidate.customerEmail,
            customerId: candidate.customerId,
            eboekhoudenInvoiceId: storedRecoveredInvoice.invoiceId,
            eboekhoudenInvoiceNumber: storedRecoveredInvoice.invoiceNumber,
            eboekhoudenInvoicePdfUrl: existing.invoice.urlPdfFile ?? null,
            entityId: candidate.paymentId,
            mode: candidate.mode,
            subscriptionId: candidate.subscriptionId,
          }),
        );

        return {
          invoiceId: storedRecoveredInvoice.invoiceId,
          invoiceNumber: storedRecoveredInvoice.invoiceNumber,
          paymentId,
          status: "created",
        };
      }
    }

    const failure = await storeFirstPaymentInvoiceCreationFailure({
      actor,
      candidate,
      error,
    });

    return {
      paymentId,
      reason: failure.errorMessage,
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
