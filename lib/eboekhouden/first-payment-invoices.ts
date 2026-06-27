import "server-only";

import { billingSettingsAreComplete, getTenantBillingSettings } from "@/lib/billing-settings";
import type { MollieMode } from "@/lib/env";
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
import {
  getFailedFirstPaymentInvoiceRetrySummary,
  queueRetryForFailedFirstPaymentInvoicesBatch,
  queueRetryForSafeFailedFirstPaymentInvoicesBatch,
} from "@/lib/eboekhouden/first-payment-invoice-retry";
import { resolveFirstPaymentInvoiceDate } from "@/lib/eboekhouden/first-payment-invoice-date";
import { findExistingEboekhoudenInvoiceByReference } from "@/lib/eboekhouden/invoice-reconcile";
import { createInvoiceBatchWithDependencies } from "@/lib/invoice-creation-batch";
import { deliverCustomerInvoiceEmail } from "@/lib/invoice-delivery";
import { createEboekhoudenInvoiceForFirstPayment } from "@/lib/eboekhouden/first-payment-invoice-workflow";

export { createEboekhoudenInvoiceForFirstPayment };
export {
  getFailedFirstPaymentInvoiceRetrySummary,
  queueRetryForFailedFirstPaymentInvoicesBatch,
  queueRetryForSafeFailedFirstPaymentInvoicesBatch,
};

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

export async function createDueFirstPaymentInvoicesBatch(input: {
  actor: InvoiceActor;
  limit?: number;
  mode: MollieMode;
  tenantId?: string;
}): Promise<FirstPaymentInvoiceBatchResult> {
  const settings = await getTenantBillingSettings(input.tenantId);

  if (!billingSettingsAreComplete(settings)) {
    throw new Error(
      "Tenant billing settings are incomplete. Select an invoice template and revenue ledger first.",
    );
  }

  await normalizeFirstPaymentInvoiceStatesImpl({
    mode: input.mode,
    tenantId: input.tenantId,
  });

  return createInvoiceBatchWithDependencies(input, {
    createInvoice: async (entityId) =>
      createEboekhoudenInvoiceForFirstPayment(entityId, {
        actor: input.actor,
        settings,
      }),
    getRemainingSummary: async (mode) =>
      getDueFirstPaymentInvoiceQueueSummaryImpl(mode, input.tenantId),
    loadCandidates: async (mode, limit) =>
      (await listDueFirstPaymentInvoiceCandidatesImpl(mode, limit, input.tenantId)).map((row) => ({
        entityId: row.paymentId,
      })),
  });
}

export async function recoverFailedFirstPaymentInvoicesBatch(input: {
  actor: InvoiceActor;
  limit?: number;
  mode: MollieMode;
  tenantId?: string;
}): Promise<FailedFirstPaymentRecoveryBatchResult> {
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
