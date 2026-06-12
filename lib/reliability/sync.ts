import "server-only";

import type { Payment } from "@mollie/api-client";

import { transaction } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import { getMollieClient, isMollieConfigured } from "@/lib/mollie/client";
import { attemptSubscriptionActivation } from "@/lib/onboarding/subscription-activation";
import { runFirstPaymentInvoiceSyncFollowUp } from "@/lib/reliability/first-payment-sync-followup";
import {
  type ReconciliationSummary,
} from "@/lib/reliability/reconciliation-summary";
import {
  handlePaymentAlerts,
  handleSubscriptionAlerts,
} from "@/lib/reliability/sync-alerts";
import {
  deriveCollectionReviewRequiredAt,
  derivePaymentRecurringCollectionState,
  resolvePaymentSyncType,
} from "@/lib/reliability/payment-sync-record";
import { persistSyncedPayment, type SyncActor } from "@/lib/reliability/sync-persistence";
import { persistSyncedSubscriptionPayments } from "@/lib/reliability/subscription-sync-persistence";
import { buildConfiguredMollieModeOrder } from "@/lib/reliability/mollie-mode-selection";
import { findMollieResourceAcrossModes } from "@/lib/reliability/mollie-resource-lookup";
import {
  collectPaymentLinkPayments,
  syncMatchingPaymentLinkForPayment,
  upsertPaymentLinkFromMollie,
} from "@/lib/reliability/payment-link-sync";
import { type PaymentLinkSyncSource } from "@/lib/reliability/payment-link-sync-record";
import {
  findLocalMandateId,
  getLocalCustomerByMollieId,
  getLocalPaymentLinkByMollieId,
  getManagedSubscription,
  getManagedSubscriptionByMollieId,
  type SyncResourceCustomerLink,
  upsertMandatesForCustomer,
} from "@/lib/reliability/sync-resource-state";
import {
  shouldRunBillingFollowups,
  type ReconciliationMode,
} from "@/lib/reliability/reconciliation-mode";
import { mapSubscriptionLifecycle } from "@/lib/subscriptions";
import {
  reconcileOperationalData as reconcileOperationalDataImpl,
} from "@/lib/reliability/reconciliation-operations";

type MolliePaymentLink = {
  createdAt?: string;
  description: string;
  expiresAt?: string;
  getPaymentUrl: () => string;
  getPayments: () => AsyncIterable<Payment>;
  id: string;
  webhookUrl?: string;
} & PaymentLinkSyncSource;

type WebhookProcessingResult = {
  customerId: string | null;
  paymentId: string | null;
  paymentLinkId: string | null;
  subscriptionId: string | null;
};

async function findPaymentAcrossModes(
  molliePaymentId: string,
  preferredMode?: MollieMode,
  strictMode = false,
) {
  const result = await findMollieResourceAcrossModes(
    buildConfiguredMollieModeOrder({
      isConfigured: isMollieConfigured,
      preferredMode,
      strictMode,
    }),
    (mode) => getMollieClient(mode).payments.get(molliePaymentId),
    "Payment was not found in Mollie.",
  );

  return {
    mode: result.mode,
    payment: result.resource,
  };
}

async function findPaymentLinkAcrossModes(
  molliePaymentLinkId: string,
  preferredMode?: MollieMode,
  strictMode = false,
) {
  const result = await findMollieResourceAcrossModes(
    buildConfiguredMollieModeOrder({
      isConfigured: isMollieConfigured,
      preferredMode,
      strictMode,
    }),
    (mode) =>
      getMollieClient(mode).paymentLinks.get(
        molliePaymentLinkId,
      ) as unknown as Promise<MolliePaymentLink>,
    "Payment link was not found in Mollie.",
  );

  return {
    mode: result.mode,
    paymentLink: result.resource,
  };
}

async function findSubscriptionAcrossModes(
  mollieSubscriptionId: string,
  customerMollieId: string,
  preferredMode?: MollieMode,
  strictMode = false,
) {
  const result = await findMollieResourceAcrossModes(
    buildConfiguredMollieModeOrder({
      isConfigured: isMollieConfigured,
      preferredMode,
      strictMode,
    }),
    async (mode) => {
      const client = getMollieClient(mode);
      const subscription = await client.customerSubscriptions.get(
        mollieSubscriptionId,
        {
          customerId: customerMollieId,
        },
      );
      const payments = await client.subscriptionPayments.page({
        customerId: customerMollieId,
        subscriptionId: mollieSubscriptionId,
      });

      return {
        payments,
        subscription,
      };
    },
    "Subscription was not found in Mollie.",
  );

  return {
    mode: result.mode,
    ...result.resource,
  };
}

export async function syncPaymentByMollieId(
  molliePaymentId: string,
  options?: {
    actor?: SyncActor;
    preferredMode?: MollieMode;
    reconciliationMode?: ReconciliationMode;
    requireManagedResource?: boolean;
    strictMode?: boolean;
    syncPaymentLinks?: boolean;
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
  );
  const localCustomer = await getLocalCustomerByMollieId(mode, payment.customerId);
  const localSubscription = await getManagedSubscriptionByMollieId(
    mode,
    payment.subscriptionId,
  );
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
      (await findLocalMandateId(mode, payment.mandateId, client)) ??
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
    });
  });

  await handlePaymentAlerts({
    customerId: resolvedCustomerId,
    localPaymentId,
    payment,
    subscriptionId: localSubscription?.id ?? null,
  });
  const localPaymentLinkId =
    options?.syncPaymentLinks === false
      ? null
      : await syncMatchingPaymentLinkForPayment(
          mode,
          payment,
          resolvedCustomerId,
          actor,
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
    });
  }

  if (
    resolvedCustomerId &&
    paymentType === "first" &&
    payment.status === "paid" &&
    shouldRunBillingFollowups(reconciliationMode)
  ) {
    await attemptSubscriptionActivation({
      actor,
      customerId: resolvedCustomerId,
      mode,
      trigger: "auto",
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
  },
) {
  const actor = options?.actor ?? {
    kind: "system" as const,
  };
  const { mode, paymentLink } = await findPaymentLinkAcrossModes(
    molliePaymentLinkId,
    options?.preferredMode,
    options?.strictMode,
  );
  const payments = await collectPaymentLinkPayments(paymentLink);
  const existingPaymentLink = await getLocalPaymentLinkByMollieId(mode, paymentLink.id);

  if (options?.requireManagedResource && !existingPaymentLink) {
    throw new Error("Payment-link webhook is not linked to a managed local resource.");
  }

  const localCustomer = await getLocalCustomerByMollieId(mode, paymentLink.customerId);
  const localPaymentLinkId = await upsertPaymentLinkFromMollie(
    mode,
    paymentLink,
    payments,
    {
      actor,
      customerId: localCustomer?.id ?? existingPaymentLink?.customerId ?? null,
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
    });
  }

  return {
    ...latestResult,
    paymentLinkId: localPaymentLinkId,
  } satisfies WebhookProcessingResult;
}

export async function syncSubscriptionByLocalId(
  localSubscriptionId: string,
  options?: {
    actor?: SyncActor;
    reconciliationMode?: ReconciliationMode;
    strictMode?: boolean;
  },
) {
  const actor = options?.actor ?? {
    kind: "system" as const,
  };
  const reconciliationMode = options?.reconciliationMode ?? "full";
  const localSubscription = await getManagedSubscription(localSubscriptionId);

  if (!localSubscription?.mollieSubscriptionId || !localSubscription.customerMollieId) {
    throw new Error("Subscription is not linked to Mollie.");
  }

  const { subscription, payments } = await findSubscriptionAcrossModes(
    localSubscription.mollieSubscriptionId,
    localSubscription.customerMollieId,
    localSubscription.mode,
    options?.strictMode,
  );
  const resolvedSubscriptionId = localSubscription.id;
  let normalizedFirstPayments: { id: string; isPaid: boolean }[] = [];
  let persistedPayments: { localPaymentId: string; payment: Payment }[] = [];

  await transaction(async (client) => {
    const localCustomer = {
      id: localSubscription.customerId,
      mollieCustomerId: localSubscription.customerMollieId,
      mode: localSubscription.mode,
    } satisfies SyncResourceCustomerLink;
    const mandateIdMap = await upsertMandatesForCustomer(client, localCustomer);
    const localMandateId =
      (subscription.mandateId
        ? mandateIdMap.get(subscription.mandateId) ?? null
        : null) ??
      (await findLocalMandateId(localSubscription.mode, subscription.mandateId, client));
    const persistedSubscription = await persistSyncedSubscriptionPayments(client, {
      actor,
      localMandateId,
      localSubscription,
      payments,
      resolvePaymentMandateId: async (paymentMandateId) =>
        (paymentMandateId ? mandateIdMap.get(paymentMandateId) ?? null : null) ??
        (await findLocalMandateId(
          localSubscription.mode,
          paymentMandateId ?? undefined,
          client,
        )),
      subscription,
    });
    normalizedFirstPayments = persistedSubscription.normalizedFirstPayments;
    persistedPayments = persistedSubscription.persistedPayments;
  });

  for (const persistedPayment of persistedPayments) {
    await handlePaymentAlerts({
      customerId: localSubscription.customerId,
      localPaymentId: persistedPayment.localPaymentId,
      payment: persistedPayment.payment,
      subscriptionId: localSubscription.id,
    });
  }

  for (const firstPayment of normalizedFirstPayments) {
    await runFirstPaymentInvoiceSyncFollowUp({
      actor,
      failureSummary:
        "Automatic first-payment invoice create skipped or failed after subscription sync.",
      isPaid: firstPayment.isPaid,
      mode: localSubscription.mode,
      paymentId: firstPayment.id,
      reconciliationMode,
    });
  }

  await handleSubscriptionAlerts({
    customerId: localSubscription.customerId,
    localStatus: mapSubscriptionLifecycle(subscription.status),
    localSubscriptionId: resolvedSubscriptionId,
  });

  return {
    customerId: localSubscription.customerId,
    paymentId: null,
    paymentLinkId: null,
    subscriptionId: resolvedSubscriptionId,
  } satisfies WebhookProcessingResult;
}

export async function syncSubscriptionByMollieId(
  mollieSubscriptionId: string,
  options?: {
    actor?: SyncActor;
    preferredMode?: MollieMode;
    strictMode?: boolean;
  },
) {
  const localSubscription =
    (options?.preferredMode
      ? await getManagedSubscriptionByMollieId(
          options.preferredMode,
          mollieSubscriptionId,
        )
      : null) ??
    (options?.strictMode
      ? null
      : ((await getManagedSubscriptionByMollieId("live", mollieSubscriptionId)) ??
        (await getManagedSubscriptionByMollieId("test", mollieSubscriptionId))));

  if (!localSubscription) {
    throw new Error("Subscription was not found locally.");
  }

  return syncSubscriptionByLocalId(localSubscription.id, {
    actor: options?.actor,
    strictMode: options?.strictMode,
  });
}

export async function reconcileOperationalData(input?: {
  actor?: SyncActor;
  mode?: MollieMode;
  reconciliationMode?: ReconciliationMode;
}): Promise<ReconciliationSummary> {
  return reconcileOperationalDataImpl({
    actor: input?.actor,
    mode: input?.mode,
    reconciliationMode: input?.reconciliationMode,
    syncPaymentByMollieId,
    syncPaymentLinkByMollieId,
    syncSubscriptionByLocalId,
  });
}
