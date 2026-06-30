import "server-only";

import type { Payment } from "@mollie/api-client";

import { transaction } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import { runFirstPaymentInvoiceSyncFollowUp } from "@/lib/reliability/first-payment-sync-followup";
import { handlePaymentAlerts, handleSubscriptionAlerts } from "@/lib/reliability/sync-alerts";
import { persistSyncedSubscriptionPayments } from "@/lib/reliability/subscription-sync-persistence";
import { findSubscriptionAcrossModes } from "@/lib/reliability/sync-mollie-lookups";
import {
  findLocalMandateId,
  getManagedSubscription,
  getManagedSubscriptionByMollieId,
  type SyncResourceCustomerLink,
  upsertMandatesForCustomer,
} from "@/lib/reliability/sync-resource-state";
import { type ReconciliationMode } from "@/lib/reliability/reconciliation-mode";
import { mapSubscriptionLifecycle } from "@/lib/subscriptions";
import type { SyncActor } from "@/lib/reliability/sync-persistence";

type SubscriptionSyncResult = {
  customerId: string | null;
  paymentId: string | null;
  paymentLinkId: string | null;
  subscriptionId: string | null;
};

export async function syncSubscriptionByLocalId(
  localSubscriptionId: string,
  options?: {
    actor?: SyncActor;
    reconciliationMode?: ReconciliationMode;
    strictMode?: boolean;
    tenantId?: string;
  },
) {
  const actor = options?.actor ?? {
    kind: "system" as const,
  };
  const reconciliationMode = options?.reconciliationMode ?? "full";
  const localSubscription = await getManagedSubscription(
    localSubscriptionId,
    options?.tenantId,
  );

  if (!localSubscription?.mollieSubscriptionId || !localSubscription.customerMollieId) {
    throw new Error("Subscription is not linked to Mollie.");
  }

  const { subscription, payments } = await findSubscriptionAcrossModes(
    localSubscription.mollieSubscriptionId,
    localSubscription.customerMollieId,
    localSubscription.mode,
    options?.strictMode,
  );
  const tenantId = localSubscription.tenantId;
  const resolvedSubscriptionId = localSubscription.id;
  let normalizedFirstPayments: { id: string; isPaid: boolean }[] = [];
  let persistedPayments: { localPaymentId: string; payment: Payment }[] = [];

  await transaction(async (client) => {
    const localCustomer = {
      id: localSubscription.customerId,
      mollieCustomerId: localSubscription.customerMollieId,
      mode: localSubscription.mode,
      tenantId,
    } satisfies SyncResourceCustomerLink;
    const mandateIdMap = await upsertMandatesForCustomer(client, localCustomer);
    const localMandateId =
      (subscription.mandateId
        ? mandateIdMap.get(subscription.mandateId) ?? null
        : null) ??
      (await findLocalMandateId(
        localSubscription.mode,
        subscription.mandateId,
        client,
        tenantId,
      ));
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
          tenantId,
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
      tenantId,
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
      tenantId,
    });
  }

  await handleSubscriptionAlerts({
    customerId: localSubscription.customerId,
    localStatus: mapSubscriptionLifecycle(subscription.status),
    localSubscriptionId: resolvedSubscriptionId,
    tenantId,
  });

  return {
    customerId: localSubscription.customerId,
    paymentId: null,
    paymentLinkId: null,
    subscriptionId: resolvedSubscriptionId,
  } satisfies SubscriptionSyncResult;
}

export async function syncSubscriptionByMollieId(
  mollieSubscriptionId: string,
  options?: {
    actor?: SyncActor;
    preferredMode?: MollieMode;
    strictMode?: boolean;
    tenantId?: string;
  },
) {
  const localSubscription =
    (options?.preferredMode
      ? await getManagedSubscriptionByMollieId(
          options.preferredMode,
          mollieSubscriptionId,
          options?.tenantId,
        )
      : null) ??
    (options?.strictMode
      ? null
      : ((await getManagedSubscriptionByMollieId(
          "live",
          mollieSubscriptionId,
          options?.tenantId,
        )) ??
        (await getManagedSubscriptionByMollieId(
          "test",
          mollieSubscriptionId,
          options?.tenantId,
        ))));

  if (!localSubscription) {
    throw new Error("Subscription was not found locally.");
  }

  return syncSubscriptionByLocalId(localSubscription.id, {
    actor: options?.actor,
    strictMode: options?.strictMode,
    tenantId: localSubscription.tenantId,
  });
}
