import "server-only";

import type { Payment } from "@mollie/api-client";
import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import type { DbClient } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import { upsertRecurringBillingScheduleForSubscription } from "@/lib/recurring-billing-schedule";
import { mapSubscriptionLifecycle } from "@/lib/subscriptions";
import {
  buildSubscriptionSyncMetadata,
  deriveSubscriptionBillingDay,
  shouldStopSubscriptionAfterCurrentPeriod,
} from "@/lib/reliability/subscription-sync-record";
import {
  deriveCollectionReviewRequiredAt,
  derivePaymentRecurringCollectionState,
  resolveFirstPaymentMode,
  resolvePaymentSyncType,
} from "@/lib/reliability/payment-sync-record";
import { persistSyncedPayment, type SyncActor } from "@/lib/reliability/sync-persistence";

export type SubscriptionSyncSource = {
  amount: {
    currency: string;
    value: string;
  };
  canceledAt?: string | null;
  description?: string;
  id: string;
  interval: string;
  mandateId?: string | null;
  nextPaymentDate?: string | null;
  startDate?: string | null;
  status: string;
};

export type SubscriptionSyncTarget = {
  customerId: string;
  id: string;
  metadata: Record<string, unknown>;
  mode: MollieMode;
  subscriptionTermMode: "fixed_term" | "open_ended";
  tenantId: string;
  totalPayments: number | null;
};

export type PersistedSubscriptionPayment = {
  localPaymentId: string;
  payment: Payment;
};

export async function persistSyncedSubscriptionPayments(
  client: DbClient,
  input: {
    actor: SyncActor;
    localMandateId: string | null;
    localSubscription: SubscriptionSyncTarget;
    payments: Payment[];
    resolvePaymentMandateId: (
      paymentMandateId: string | null | undefined,
    ) => Promise<string | null>;
    subscription: SubscriptionSyncSource;
  },
) {
  const normalizedFirstPayments: { id: string; isPaid: boolean }[] = [];
  const persistedPayments: PersistedSubscriptionPayment[] = [];
  const localStatus = mapSubscriptionLifecycle(input.subscription.status);

  await client.execute(sql`
      update subscriptions
      set
        mandate_id = ${input.localMandateId},
        local_status = ${localStatus},
        mollie_status = ${input.subscription.status},
        description = ${input.subscription.description},
        interval = ${input.subscription.interval},
        amount_value = ${input.subscription.amount.value},
        amount_currency = ${input.subscription.amount.currency},
        billing_day = ${deriveSubscriptionBillingDay(input.subscription)},
        start_date = ${input.subscription.startDate}::date,
        stop_after_current_period = ${shouldStopSubscriptionAfterCurrentPeriod(input.subscription)},
        canceled_at = ${input.subscription.canceledAt ?? null}::timestamptz,
        metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(
          buildSubscriptionSyncMetadata(input.subscription),
        )}::jsonb,
        updated_at = now(),
        last_synced_at = now()
      where id = ${input.localSubscription.id}
        and tenant_id = ${input.localSubscription.tenantId}
    `);

  await upsertRecurringBillingScheduleForSubscription(client, {
    actor: input.actor,
    amountCurrency: input.subscription.amount.currency,
    amountValue: input.subscription.amount.value,
    firstPaymentMode: resolveFirstPaymentMode(input.localSubscription.metadata),
    interval: input.subscription.interval,
    mode: input.localSubscription.mode,
    nextPaymentDate: input.subscription.nextPaymentDate ?? null,
    periodLimit: 1,
    startDate: null,
    subscriptionId: input.localSubscription.id,
    subscriptionTermMode: input.localSubscription.subscriptionTermMode,
    totalPayments: input.localSubscription.totalPayments,
  });

  for (const payment of input.payments) {
    const linkedMandateId =
      (await input.resolvePaymentMandateId(payment.mandateId)) ??
      input.localMandateId ??
      null;
    const paymentType = resolvePaymentSyncType(payment);
    const recurringCollectionState = derivePaymentRecurringCollectionState(payment);
    const collectionReviewRequiredAt = deriveCollectionReviewRequiredAt(
      recurringCollectionState,
    );
    const localPaymentId = await persistSyncedPayment(client, {
      actor: input.actor,
      collectionReviewRequiredAt,
      customerId: input.localSubscription.customerId,
      localMandateId: linkedMandateId,
      localSubscriptionId: input.localSubscription.id,
      mode: input.localSubscription.mode,
      payment,
      paymentType,
      recurringCollectionState,
      tenantId: input.localSubscription.tenantId,
    });

    persistedPayments.push({ localPaymentId, payment });

    if (paymentType === "first") {
      normalizedFirstPayments.push({
        id: localPaymentId,
        isPaid: payment.status === "paid",
      });
    }
  }

  await writeAuditLog(
    {
      action: "subscription.sync",
      details: {
        localSubscriptionId: input.localSubscription.id,
        mollieSubscriptionId: input.subscription.id,
        paymentCount: input.payments.length,
      },
      entityId: input.localSubscription.id,
      entityType: "subscription",
      mode: input.localSubscription.mode,
      outcome: "success",
      summary: "Refreshed the subscription and its payments from Mollie.",
    },
    client,
    input.actor,
  );

  return {
    normalizedFirstPayments,
    persistedPayments,
  };
}
