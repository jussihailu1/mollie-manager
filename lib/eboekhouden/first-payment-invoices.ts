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
import { buildFirstPaymentInvoiceReference } from "@/lib/eboekhouden/invoice-reference";
import {
  type FirstPaymentInvoiceActor,
  claimFirstPaymentInvoiceForCreation,
  storeFirstPaymentInvoiceCreationFailure,
  storeFirstPaymentInvoiceCreationSuccess,
} from "@/lib/eboekhouden/first-payment-invoice-persistence";
import {
  buildFirstPaymentInvoiceDelivery,
} from "@/lib/eboekhouden/first-payment-invoice-delivery";
import {
  getFirstPaymentInvoiceCandidate,
  type FirstPaymentInvoiceCandidate,
} from "@/lib/eboekhouden/first-payment-invoice-candidate";
import {
  buildDeterministicMatchCte,
} from "@/lib/eboekhouden/first-payment-invoice-match-query";
import {
  getDueFirstPaymentInvoiceQueueSummary as getDueFirstPaymentInvoiceQueueSummaryImpl,
  listDueFirstPaymentInvoiceCandidates as listDueFirstPaymentInvoiceCandidatesImpl,
  normalizeFirstPaymentInvoiceStates as normalizeFirstPaymentInvoiceStatesImpl,
} from "@/lib/eboekhouden/first-payment-invoice-queue";
import {
  listFailedFirstPaymentRecoveryCandidates,
  storeRecoveredFailedFirstPaymentSuccess,
} from "@/lib/eboekhouden/first-payment-invoice-recovery";
import {
  getFailedFirstPaymentInvoiceRetrySummary as getFailedFirstPaymentInvoiceRetrySummaryImpl,
  queueRetryForFailedFirstPaymentInvoicesBatch as queueRetryForFailedFirstPaymentInvoicesBatchImpl,
  queueRetryForSafeFailedFirstPaymentInvoicesBatch as queueRetryForSafeFailedFirstPaymentInvoicesBatchImpl,
} from "@/lib/eboekhouden/first-payment-invoice-retry";
import { resolveFirstPaymentInvoiceDate } from "@/lib/eboekhouden/first-payment-invoice-date";
import { findExistingEboekhoudenInvoiceByReference } from "@/lib/eboekhouden/invoice-reconcile";
import {
  buildInvoiceCreationFailureMetadata,
} from "@/lib/eboekhouden/invoice-creation-metadata";
import {
  buildInvoiceRetryQueuedMetadata,
} from "@/lib/eboekhouden/invoice-retry-metadata";
import {
  serializeInvoiceErrorMessage,
  toInvoiceCount,
} from "@/lib/eboekhouden/invoice-flow-helpers";
import { createEboekhoudenInvoiceForFirstPayment } from "@/lib/eboekhouden/first-payment-invoice-workflow";
import { createInvoiceBatchWithDependencies } from "@/lib/invoice-creation-batch";
import { deliverCustomerInvoiceEmail } from "@/lib/invoice-delivery";
import { saveStoredInvoice, type InvoiceProvider } from "@/lib/invoices";
import {
  getInvoiceProviderAdapterById,
} from "@/lib/invoicing/provider-resolver";
import type {
  InvoiceProviderCreateResult,
} from "@/lib/invoicing/provider-types";
import { openAlert } from "@/lib/reliability/alerts";
import { subscriptionConsentPlanSnapshotSchema } from "@/lib/subscription-consent";

export { createEboekhoudenInvoiceForFirstPayment };

const DEFAULT_BATCH_SIZE = 25;
const FIRST_PAYMENT_TERMINAL_OR_IN_PROGRESS_STATES = [
  "invoice_creating",
  "invoice_created",
  "invoice_failed",
  "invoice_sent",
] as const;

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

type DueFirstPaymentInvoiceQueueSummary = {
  actionableCount: number;
  blockedCount: number;
  dueCount: number;
};

type DueFirstPaymentInvoiceCandidate = {
  paymentId: string;
};

function getProviderLabel(provider: InvoiceProvider) {
  return provider === "eboekhouden" ? "e-Boekhouden" : "Mollie";
}

async function resolveTenantId(tenantId?: string) {
  if (!tenantId) {
    throw new Error("Tenant id is required.");
  }

  return tenantId;
}

async function listProviderAgnosticDueFirstPaymentInvoiceCandidates(
  mode: MollieMode,
  limit = 25,
  tenantId?: string,
) {
  const resolvedTenantId = await resolveTenantId(tenantId);
  const result = await getDb().execute<DueFirstPaymentInvoiceCandidate>(sql`
    ${buildDeterministicMatchCte({ mode, tenantId: resolvedTenantId })}
    select
      p.id as "paymentId"
    from payments p
    inner join deterministic_matches dm on dm.payment_id = p.id
    where p.tenant_id = ${resolvedTenantId}
      and p.mode = ${mode}
      and p.payment_type = 'first'
      and p.mollie_status = 'paid'
      and dm.consent_accepted_at is not null
      and dm.first_payment_mode = 'real_installment'
      and p.invoice_state = 'pending_invoice'
      and not exists (
        select 1
        from invoices i
        where i.tenant_id = p.tenant_id
          and i.owner_type = 'payment'
          and i.owner_id = p.id
      )
    order by coalesce(p.paid_at, p.created_at) asc, p.created_at asc
    limit ${Math.max(1, limit)}
  `);

  return result.rows;
}

async function getProviderAgnosticDueFirstPaymentInvoiceQueueSummary(
  mode: MollieMode,
  tenantId?: string,
): Promise<DueFirstPaymentInvoiceQueueSummary> {
  const resolvedTenantId = await resolveTenantId(tenantId);
  const result = await getDb().execute<{
    dueCount: number | string;
  }>(sql`
    ${buildDeterministicMatchCte({ mode, tenantId: resolvedTenantId })}
    select
      count(*) as "dueCount"
    from payments p
    inner join deterministic_matches dm on dm.payment_id = p.id
    where p.tenant_id = ${resolvedTenantId}
      and p.mode = ${mode}
      and p.payment_type = 'first'
      and p.mollie_status = 'paid'
      and dm.consent_accepted_at is not null
      and dm.first_payment_mode = 'real_installment'
      and not exists (
        select 1
        from invoices i
        where i.tenant_id = p.tenant_id
          and i.owner_type = 'payment'
          and i.owner_id = p.id
      )
      and p.invoice_state not in (
        ${FIRST_PAYMENT_TERMINAL_OR_IN_PROGRESS_STATES[0]},
        ${FIRST_PAYMENT_TERMINAL_OR_IN_PROGRESS_STATES[1]},
        ${FIRST_PAYMENT_TERMINAL_OR_IN_PROGRESS_STATES[2]},
        ${FIRST_PAYMENT_TERMINAL_OR_IN_PROGRESS_STATES[3]}
      )
  `);
  const dueCount = toInvoiceCount(result.rows[0]?.dueCount);

  return {
    actionableCount: dueCount,
    blockedCount: 0,
    dueCount,
  };
}

async function getProviderAwareFailedFirstPaymentRetrySummary(
  mode: MollieMode,
  tenantId?: string,
): Promise<FailedFirstPaymentInvoiceRetrySummary> {
  const resolvedTenantId = await resolveTenantId(tenantId);
  const result = await getDb().execute<{
    totalFailedCount: number | string;
  }>(sql`
    select count(*) as "totalFailedCount"
    from payments p
    where p.mode = ${mode}
      and p.tenant_id = ${resolvedTenantId}
      and p.payment_type = 'first'
      and p.invoice_state = 'invoice_failed'
      and not exists (
        select 1
        from invoices i
        where i.tenant_id = p.tenant_id
          and i.owner_type = 'payment'
          and i.owner_id = p.id
      )
  `);
  const totalFailedCount = toInvoiceCount(result.rows[0]?.totalFailedCount);

  return {
    retryableCount: totalFailedCount,
    totalFailedCount,
  };
}

async function queueProviderAgnosticFirstPaymentRetries(input: {
  actor: FirstPaymentInvoiceActor;
  mode: MollieMode;
  paymentIds: string[];
  tenantId?: string;
}): Promise<FailedFirstPaymentRetryBatchResult> {
  const resolvedTenantId = await resolveTenantId(input.tenantId);
  let queuedCount = 0;
  let skippedCount = 0;

  for (const paymentId of input.paymentIds) {
    const result = await getDb().execute<{ id: string }>(sql`
      update payments p
      set
        invoice_state = 'pending_invoice',
        invoice_failed_at = null,
        metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(
          buildInvoiceRetryQueuedMetadata({
            actorEmail: input.actor.email,
          }),
        )}::jsonb,
        updated_at = now()
      where p.id = ${paymentId}
        and p.mode = ${input.mode}
        and p.tenant_id = ${resolvedTenantId}
        and p.payment_type = 'first'
        and p.invoice_state = 'invoice_failed'
        and not exists (
          select 1
          from invoices i
          where i.tenant_id = p.tenant_id
            and i.owner_type = 'payment'
            and i.owner_id = p.id
        )
      returning p.id as id
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

async function queueSafeProviderAgnosticFirstPaymentRetries(input: {
  actor: FirstPaymentInvoiceActor;
  limit?: number;
  mode: MollieMode;
  tenantId?: string;
}) {
  const resolvedTenantId = await resolveTenantId(input.tenantId);
  const rows = await getDb().execute<{ id: string }>(sql`
    select p.id as id
    from payments p
    where p.mode = ${input.mode}
      and p.tenant_id = ${resolvedTenantId}
      and p.payment_type = 'first'
      and p.invoice_state = 'invoice_failed'
      and not exists (
        select 1
        from invoices i
        where i.tenant_id = p.tenant_id
          and i.owner_type = 'payment'
          and i.owner_id = p.id
      )
    order by p.updated_at asc, p.created_at asc
    limit ${Math.max(1, input.limit ?? DEFAULT_BATCH_SIZE)}
  `);

  return queueProviderAgnosticFirstPaymentRetries({
    actor: input.actor,
    mode: input.mode,
    paymentIds: rows.rows.map((row) => row.id),
    tenantId: resolvedTenantId,
  });
}

async function storeProviderFirstPaymentInvoiceSuccess(input: {
  actor: FirstPaymentInvoiceActor;
  candidate: FirstPaymentInvoiceCandidate;
  invoice: InvoiceProviderCreateResult;
  source?: "created" | "reconciled_existing";
}) {
  const providerLabel = getProviderLabel(input.invoice.provider);
  const source = input.source ?? "created";
  const invoiceId = input.invoice.providerInvoiceId;
  const invoiceNumber = input.invoice.providerInvoiceNumber;

  await transaction(async (tx) => {
    await tx.execute(sql`
      update payments
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
      where id = ${input.candidate.paymentId}
        and tenant_id = ${input.candidate.tenantId}
        and invoice_state = 'invoice_creating'
    `);

    await saveStoredInvoice(
      {
        mode: input.candidate.mode,
        ownerId: input.candidate.paymentId,
        ownerType: "payment",
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
        action: "first_payment_invoice.create",
        details: {
          consentId: input.candidate.consentId,
          invoiceProvider: input.invoice.provider,
          providerInvoiceId: invoiceId,
          providerInvoiceNumber: invoiceNumber,
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
            ? `Created a ${providerLabel} invoice for a paid first payment.`
            : `Recovered an existing ${providerLabel} invoice for a paid first payment.`,
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
        and payload ->> 'tenantId' = ${input.candidate.tenantId}
    `);

    await openAlert(
      {
        customerId: input.candidate.customerId,
        message:
          source === "created"
            ? `Created ${providerLabel} invoice ${invoiceNumber ?? invoiceId ?? "without returned number"} for the paid first payment ${input.candidate.paymentId}.`
            : `Recovered existing ${providerLabel} invoice ${invoiceNumber ?? invoiceId ?? "without returned number"} for the paid first payment ${input.candidate.paymentId}.`,
        paymentId: input.candidate.paymentId,
        payload: {
          invoiceProvider: input.invoice.provider,
          kind: "first_payment_invoice_created",
          mode: input.candidate.mode,
          paymentId: input.candidate.paymentId,
          providerInvoiceId: invoiceId,
          providerInvoiceNumber: invoiceNumber,
          source,
        },
        severity: "info",
        subscriptionId: input.candidate.subscriptionId,
        tenantId: input.candidate.tenantId,
        title:
          source === "created"
            ? "First-payment invoice created"
            : "First-payment invoice recovered",
      },
      tx,
    );
  });

  return {
    invoiceId,
    invoiceNumber,
  };
}

async function storeProviderFirstPaymentInvoiceFailure(input: {
  actor: FirstPaymentInvoiceActor;
  candidate: FirstPaymentInvoiceCandidate;
  error: unknown;
  provider: InvoiceProvider;
}) {
  const providerLabel = getProviderLabel(input.provider);
  const errorMessage = serializeInvoiceErrorMessage(
    input.error,
    "First-payment invoice creation failed.",
  );

  await transaction(async (tx) => {
    await tx.execute(sql`
      update payments
      set
        invoice_state = 'invoice_failed',
        invoice_failed_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(
          buildInvoiceCreationFailureMetadata({ errorMessage }),
        )}::jsonb || ${JSON.stringify({
          invoiceProvider: input.provider,
        })}::jsonb,
        updated_at = now()
      where id = ${input.candidate.paymentId}
        and tenant_id = ${input.candidate.tenantId}
        and invoice_state = 'invoice_creating'
    `);

    await writeAuditLog(
      {
        action: "first_payment_invoice.create",
        details: {
          consentId: input.candidate.consentId,
          error: errorMessage,
          invoiceProvider: input.provider,
          molliePaymentId: input.candidate.molliePaymentId,
          paymentId: input.candidate.paymentId,
          paymentLinkId: input.candidate.paymentLinkId,
        },
        entityId: input.candidate.paymentId,
        entityType: "payment",
        mode: input.candidate.mode,
        outcome: "failure",
        summary: `First-payment ${providerLabel} invoice creation failed for a paid first payment.`,
      },
      tx,
      input.actor,
    );

    await openAlert(
      {
        customerId: input.candidate.customerId,
        message:
          `Could not create the first-payment ${providerLabel} invoice. Review the payment before retrying so a duplicate invoice is not created upstream.`,
        paymentId: input.candidate.paymentId,
        payload: {
          error: errorMessage,
          invoiceProvider: input.provider,
          kind: "first_payment_invoice_creation_failed",
          mode: input.candidate.mode,
          paymentId: input.candidate.paymentId,
        },
        severity: "warning",
        subscriptionId: input.candidate.subscriptionId,
        tenantId: input.candidate.tenantId,
        title: "First-payment invoice creation failed",
      },
      tx,
    );
  });

  return {
    errorMessage,
  };
}

export async function createInvoiceForFirstPayment(
  paymentId: string,
  options: {
    actor?: FirstPaymentInvoiceActor;
    tenantId: string;
  },
): Promise<CreateFirstPaymentInvoiceResult> {
  const actor = options.actor ?? { kind: "system" as const };
  const settings = await getTenantBillingSettings(options.tenantId);
  const provider = settings?.activeInvoiceProvider ?? "mollie";

  if (provider === "eboekhouden") {
    return createEboekhoudenInvoiceForFirstPayment(paymentId, {
      actor,
      settings,
      tenantId: options.tenantId,
    });
  }

  const candidate = await getFirstPaymentInvoiceCandidate(paymentId, options.tenantId);
  if (!candidate) {
    return {
      paymentId,
      reason:
        "First payment was not found or did not match a deterministic accepted onboarding consent.",
      status: "skipped",
    };
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

  const claimedPaymentId = await claimFirstPaymentInvoiceForCreation({
    actor,
    mode: candidate.mode,
    paymentId,
    tenantId: options.tenantId,
  });

  if (!claimedPaymentId) {
    return {
      paymentId,
      reason: "Payment row was already claimed, already invoiced, or is no longer pending invoice creation.",
      status: "skipped",
    };
  }

  try {
    const invoiceDate = resolveFirstPaymentInvoiceDate({
      paidAt: candidate.paidAt,
      paymentCreatedAt: candidate.paymentCreatedAt,
    });
    if (!invoiceDate) {
      throw new Error("Could not derive the invoice date for the paid first payment.");
    }

    const reference = buildFirstPaymentInvoiceReference({
      invoiceDate,
      paymentId: candidate.paymentId,
    });
    const parsedPlanSnapshot = subscriptionConsentPlanSnapshotSchema.safeParse(
      candidate.planSnapshot,
    );

    if (!parsedPlanSnapshot.success) {
      throw new Error("Stored onboarding consent snapshot is invalid.");
    }

    const providerCustomerId = adapter.getCapabilities().requiresCustomerLink &&
      candidate.customerId
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
        date: invoiceDate,
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
        const storedRecoveredInvoice = await storeProviderFirstPaymentInvoiceSuccess({
          actor,
          candidate,
          invoice: existing.invoice,
          source: "reconciled_existing",
        });

        await deliverCustomerInvoiceEmail({
          actor,
          customerEmail: candidate.customerEmail,
          customerId: candidate.customerId,
          entityId: candidate.paymentId,
          invoiceDocumentUrl: existing.invoice.providerDocumentUrl,
          invoiceId: storedRecoveredInvoice.invoiceId,
          invoiceNumber: storedRecoveredInvoice.invoiceNumber,
          invoiceProvider: existing.invoice.provider,
          invoiceType: "first_payment",
          mode: candidate.mode,
          subscriptionId: candidate.subscriptionId,
          tenantId: candidate.tenantId,
        });

        return {
          invoiceId: storedRecoveredInvoice.invoiceId,
          invoiceNumber: storedRecoveredInvoice.invoiceNumber,
          paymentId,
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
      description: parsedPlanSnapshot.data.description,
      invoiceDate,
      mode: candidate.mode,
      ownerId: candidate.paymentId,
      ownerType: "payment",
      providerCustomerId,
      reference,
      settings: settings!,
      termOfPaymentDays: 0,
      tenantId: candidate.tenantId,
    });

    const storedInvoice = await storeProviderFirstPaymentInvoiceSuccess({
      actor,
      candidate,
      invoice,
    });

    await deliverCustomerInvoiceEmail({
      actor,
      customerEmail: candidate.customerEmail,
      customerId: candidate.customerId,
      entityId: candidate.paymentId,
      invoiceDocumentUrl: invoice.providerDocumentUrl,
      invoiceId: storedInvoice.invoiceId,
      invoiceNumber: storedInvoice.invoiceNumber,
      invoiceProvider: invoice.provider,
      invoiceType: "first_payment",
      mode: candidate.mode,
      subscriptionId: candidate.subscriptionId,
      tenantId: candidate.tenantId,
    });

    return {
      invoiceId: storedInvoice.invoiceId,
      invoiceNumber: storedInvoice.invoiceNumber,
      paymentId,
      status: "created",
    };
  } catch (error) {
    const failure = await storeProviderFirstPaymentInvoiceFailure({
      actor,
      candidate,
      error,
      provider,
    });

    return {
      paymentId,
      reason: failure.errorMessage,
      status: "failed",
    };
  }
}

export async function getFailedFirstPaymentInvoiceRetrySummary(
  mode: MollieMode,
  tenantId?: string,
): Promise<FailedFirstPaymentInvoiceRetrySummary> {
  const resolvedTenantId = await resolveTenantId(tenantId);
  const provider = await getTenantActiveInvoiceProvider(resolvedTenantId);

  return provider === "eboekhouden"
    ? getFailedFirstPaymentInvoiceRetrySummaryImpl(mode, resolvedTenantId)
    : getProviderAwareFailedFirstPaymentRetrySummary(mode, resolvedTenantId);
}

export async function queueRetryForFailedFirstPaymentInvoicesBatch(input: {
  actor: FirstPaymentInvoiceActor;
  mode: MollieMode;
  paymentIds: string[];
  tenantId?: string;
}): Promise<FailedFirstPaymentRetryBatchResult> {
  const resolvedTenantId = await resolveTenantId(input.tenantId);
  const provider = await getTenantActiveInvoiceProvider(resolvedTenantId);

  return provider === "eboekhouden"
    ? queueRetryForFailedFirstPaymentInvoicesBatchImpl({
        ...input,
        tenantId: resolvedTenantId,
      })
    : queueProviderAgnosticFirstPaymentRetries({
        ...input,
        tenantId: resolvedTenantId,
      });
}

export async function queueRetryForSafeFailedFirstPaymentInvoicesBatch(input: {
  actor: FirstPaymentInvoiceActor;
  limit?: number;
  mode: MollieMode;
  tenantId?: string;
}): Promise<FailedFirstPaymentRetryBatchResult> {
  const resolvedTenantId = await resolveTenantId(input.tenantId);
  const provider = await getTenantActiveInvoiceProvider(resolvedTenantId);

  return provider === "eboekhouden"
    ? queueRetryForSafeFailedFirstPaymentInvoicesBatchImpl({
        ...input,
        tenantId: resolvedTenantId,
      })
    : queueSafeProviderAgnosticFirstPaymentRetries({
        ...input,
        tenantId: resolvedTenantId,
      });
}

export async function getDueFirstPaymentInvoiceQueueSummary(
  mode: MollieMode,
  tenantId?: string,
): Promise<DueFirstPaymentInvoiceQueueSummary> {
  const resolvedTenantId = await resolveTenantId(tenantId);
  const provider = await getTenantActiveInvoiceProvider(resolvedTenantId);

  return provider === "eboekhouden"
    ? getDueFirstPaymentInvoiceQueueSummaryImpl(mode, resolvedTenantId)
    : getProviderAgnosticDueFirstPaymentInvoiceQueueSummary(mode, resolvedTenantId);
}

export async function listDueFirstPaymentInvoiceCandidates(
  mode: MollieMode,
  limit = DEFAULT_BATCH_SIZE,
  tenantId?: string,
) {
  const resolvedTenantId = await resolveTenantId(tenantId);
  const provider = await getTenantActiveInvoiceProvider(resolvedTenantId);

  return provider === "eboekhouden"
    ? listDueFirstPaymentInvoiceCandidatesImpl(mode, limit, resolvedTenantId)
    : listProviderAgnosticDueFirstPaymentInvoiceCandidates(
        mode,
        limit,
        resolvedTenantId,
      );
}

export {
  normalizeFirstPaymentInvoiceStatesImpl as normalizeFirstPaymentInvoiceStates,
};

export async function createDueFirstPaymentInvoicesBatch(input: {
  actor: InvoiceActor;
  limit?: number;
  mode: MollieMode;
  tenantId: string;
}): Promise<FirstPaymentInvoiceBatchResult> {
  const settings = await getTenantBillingSettings(input.tenantId);
  const provider = settings?.activeInvoiceProvider ?? "mollie";
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

  await normalizeFirstPaymentInvoiceStatesImpl({
    mode: input.mode,
    tenantId: input.tenantId,
  });

  return createInvoiceBatchWithDependencies(input, {
    createInvoice: async (entityId) =>
      createInvoiceForFirstPayment(entityId, {
        actor: input.actor,
        tenantId: input.tenantId,
      }),
    getRemainingSummary: async (mode) =>
      getDueFirstPaymentInvoiceQueueSummary(mode, input.tenantId),
    loadCandidates: async (mode, limit) =>
      (await listDueFirstPaymentInvoiceCandidates(mode, limit, input.tenantId)).map(
        (row) => ({
          entityId: row.paymentId,
        }),
      ),
  });
}

export async function recoverFailedFirstPaymentInvoicesBatch(input: {
  actor: InvoiceActor;
  limit?: number;
  mode: MollieMode;
  tenantId: string;
}): Promise<FailedFirstPaymentRecoveryBatchResult> {
  const provider = await getTenantActiveInvoiceProvider(input.tenantId);

  if (provider !== "eboekhouden") {
    return {
      ambiguousCount: 0,
      recoveredCount: 0,
      scannedCount: 0,
    };
  }

  const candidates = await listFailedFirstPaymentRecoveryCandidates(
    input.mode,
    input.limit ?? DEFAULT_BATCH_SIZE,
    input.tenantId,
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
      tenantId: candidate.tenantId,
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
        entityId: candidate.paymentId,
        invoiceDocumentUrl: existing.invoice.urlPdfFile ?? null,
        invoiceId: recovered.invoiceId,
        invoiceNumber: recovered.invoiceNumber,
        mode: candidate.mode,
        subscriptionId: candidate.subscriptionId,
        tenantId: candidate.tenantId,
      }),
    );
  }

  return {
    ambiguousCount,
    recoveredCount,
    scannedCount: candidates.length,
  };
}
