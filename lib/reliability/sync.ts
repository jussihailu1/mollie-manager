import "server-only";

import { transaction } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import { attemptSubscriptionActivation } from "@/lib/onboarding/subscription-activation";
import { deliverSubscriptionActivationNotificationsBatch } from "@/lib/onboarding/subscription-activation-notifications";
import { runFailedPaymentCustomerNotificationForSyncedPayment } from "@/lib/failed-payment-customer-notifications";
import { runFirstPaymentInvoiceSyncFollowUp } from "@/lib/reliability/first-payment-sync-followup";
import {
  type ReconciliationSummary,
} from "@/lib/reliability/reconciliation-summary";
import { handlePaymentAlerts } from "@/lib/reliability/sync-alerts";
import {
  deriveCollectionReviewRequiredAt,
  derivePaymentRecurringCollectionState,
  resolvePaymentSyncType,
} from "@/lib/reliability/payment-sync-record";
import { persistSyncedPayment, type SyncActor } from "@/lib/reliability/sync-persistence";
import { collectPaymentLinkPayments, syncMatchingPaymentLinkForPayment, upsertPaymentLinkFromMollie } from "@/lib/reliability/payment-link-sync";
import {
  findPaymentAcrossModes,
  findPaymentLinkAcrossModes,
} from "@/lib/reliability/sync-mollie-lookups";
import {
  findLocalMandateId,
  getLocalCustomerByMollieId,
  getLocalPaymentLinkByMollieId,
  getManagedSubscriptionByMollieId,
  upsertMandatesForCustomer,
} from "@/lib/reliability/sync-resource-state";
import { syncSubscriptionByLocalId, syncSubscriptionByMollieId } from "@/lib/reliability/subscription-sync-operations";
import {
  shouldRunBillingFollowups,
  type ReconciliationMode,
} from "@/lib/reliability/reconciliation-mode";
import {
  reconcileOperationalData as reconcileOperationalDataImpl,
} from "@/lib/reliability/reconciliation-operations";

export { syncSubscriptionByLocalId, syncSubscriptionByMollieId };

type WebhookProcessingResult = {
  customerId: string | null;
  paymentId: string | null;
  paymentLinkId: string | null;
  subscriptionId: string | null;
};

export async function syncPaymentByMollieId(
  molliePaymentId: string,
  options?: {
    actor?: SyncActor;
    preferredMode?: MollieMode;
    reconciliationMode?: ReconciliationMode;
    requireManagedResource?: boolean;
    strictMode?: boolean;
    syncPaymentLinks?: boolean;
    tenantId?: string;
  },
) {
  const actor = options?.actor ?? {
    kind: "system" as const,
  };
  const reconciliationMode = options?.reconciliationMode ?? "full";
  const { mode, payment } = await findPaymentAcrossModes(
    molliePaymentId,
    options?.preferredMode,
    options?.strictMode,
    options?.tenantId,
  );
  const localCustomer = await getLocalCustomerByMollieId(
    mode,
    payment.customerId,
    options?.tenantId,
  );
  const localSubscription = await getManagedSubscriptionByMollieId(
    mode,
    payment.subscriptionId,
    options?.tenantId ?? localCustomer?.tenantId ?? undefined,
  );
  const resolvedTenantId =
    options?.tenantId ?? localCustomer?.tenantId ?? localSubscription?.tenantId;
  if (!resolvedTenantId) {
    throw new Error("Payment tenant context is missing.");
  }
  const resolvedCustomerId = localCustomer?.id ?? localSubscription?.customerId ?? null;

  if (options?.requireManagedResource && !resolvedCustomerId) {
    throw new Error("Payment webhook is not linked to a managed local resource.");
  }

  const paymentType = resolvePaymentSyncType(payment);
  const recurringCollectionState = derivePaymentRecurringCollectionState(payment);
  const collectionReviewRequiredAt = deriveCollectionReviewRequiredAt(
    recurringCollectionState,
  );
  let localPaymentId = crypto.randomUUID();

  await transaction(async (client) => {
    const mandateIdMap = localCustomer
      ? await upsertMandatesForCustomer(client, localCustomer)
      : new Map<string, string>();
    const localMandateId =
      (payment.mandateId ? mandateIdMap.get(payment.mandateId) ?? null : null) ??
      (await findLocalMandateId(
        mode,
        payment.mandateId,
        client,
        resolvedTenantId,
      )) ??
      localSubscription?.mandateId ??
      null;
    localPaymentId = await persistSyncedPayment(client, {
      actor,
      collectionReviewRequiredAt,
      customerId: resolvedCustomerId,
      localMandateId,
      localSubscriptionId: localSubscription?.id ?? null,
      mode,
      payment,
      paymentType,
      recurringCollectionState,
      tenantId: resolvedTenantId,
    });
  });

  await handlePaymentAlerts({
    customerId: resolvedCustomerId,
    localPaymentId,
    payment,
    subscriptionId: localSubscription?.id ?? null,
    tenantId: resolvedTenantId,
  });
  await runFailedPaymentCustomerNotificationForSyncedPayment({
    localPaymentId,
    mode,
    payment,
    recurringCollectionState,
  });
  const localPaymentLinkId =
    options?.syncPaymentLinks === false
      ? null
      : await syncMatchingPaymentLinkForPayment(
          mode,
          payment,
          resolvedCustomerId,
          actor,
          resolvedTenantId,
        );

  if (paymentType === "first") {
    await runFirstPaymentInvoiceSyncFollowUp({
      actor,
      failureSummary:
        "Automatic first-payment invoice create skipped or failed after paid sync.",
      isPaid: payment.status === "paid",
      mode,
      paymentId: localPaymentId,
      reconciliationMode,
      tenantId: resolvedTenantId,
    });
  }

  if (
    resolvedCustomerId &&
    paymentType === "first" &&
    payment.status === "paid" &&
    shouldRunBillingFollowups(reconciliationMode)
  ) {
    const activation = await attemptSubscriptionActivation({
      actor,
      customerId: resolvedCustomerId,
      mode,
      tenantId: resolvedTenantId,
      trigger: "auto",
    });

    if (activation.status === "failed" || activation.status === "pending_prerequisites") {
      const reason = activation.status === "failed" ? activation.message : activation.reason;
      throw new Error(`Subscription activation is not ready: ${reason}`);
    }

    await deliverSubscriptionActivationNotificationsBatch({
      limit: 100,
      mode,
      tenantId: resolvedTenantId,
    });
  }

  return {
    customerId: resolvedCustomerId,
    paymentId: localPaymentId,
    paymentLinkId: localPaymentLinkId,
    subscriptionId: localSubscription?.id ?? null,
  } satisfies WebhookProcessingResult;
}

export async function syncPaymentLinkByMollieId(
  molliePaymentLinkId: string,
  options?: {
    actor?: SyncActor;
    preferredMode?: MollieMode;
    requireManagedResource?: boolean;
    strictMode?: boolean;
    tenantId?: string;
  },
) {
  const actor = options?.actor ?? {
    kind: "system" as const,
  };
  const { mode, paymentLink } = await findPaymentLinkAcrossModes(
    molliePaymentLinkId,
    options?.preferredMode,
    options?.strictMode,
    options?.tenantId,
  );
  const payments = await collectPaymentLinkPayments(paymentLink);
  const existingPaymentLink = await getLocalPaymentLinkByMollieId(
    mode,
    paymentLink.id,
    undefined,
    options?.tenantId,
  );
  const localCustomer = await getLocalCustomerByMollieId(
    mode,
    paymentLink.customerId,
    options?.tenantId,
  );
  const resolvedTenantId =
    options?.tenantId ?? localCustomer?.tenantId ?? existingPaymentLink?.tenantId;

  if (!resolvedTenantId) {
    throw new Error("Payment-link tenant context is missing.");
  }

  if (options?.requireManagedResource && !existingPaymentLink) {
    throw new Error("Payment-link webhook is not linked to a managed local resource.");
  }

  const localPaymentLinkId = await upsertPaymentLinkFromMollie(
    mode,
    paymentLink,
    payments,
    {
      actor,
      customerId: localCustomer?.id ?? existingPaymentLink?.customerId ?? null,
      tenantId: resolvedTenantId,
    },
  );
  let latestResult: WebhookProcessingResult = {
    customerId: localCustomer?.id ?? existingPaymentLink?.customerId ?? null,
    paymentId: null,
    paymentLinkId: localPaymentLinkId,
    subscriptionId: null,
  };

  for (const payment of payments) {
    latestResult = await syncPaymentByMollieId(payment.id, {
      actor,
      preferredMode: mode,
      strictMode: true,
      syncPaymentLinks: false,
      tenantId: resolvedTenantId,
    });
  }

  return {
    ...latestResult,
    paymentLinkId: localPaymentLinkId,
  } satisfies WebhookProcessingResult;
}

export async function reconcileOperationalData(input: {
  actor?: SyncActor;
  mode?: MollieMode;
  reconciliationMode?: ReconciliationMode;
  tenantId: string;
}): Promise<ReconciliationSummary> {
  return reconcileOperationalDataImpl({
    actor: input.actor,
    mode: input.mode,
    reconciliationMode: input.reconciliationMode,
    tenantId: input.tenantId,
    syncPaymentByMollieId,
    syncPaymentLinkByMollieId,
    syncSubscriptionByLocalId,
  });
}
