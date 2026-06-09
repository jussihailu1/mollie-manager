import "server-only";

import type { Payment } from "@mollie/api-client";
import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import type { DbClient } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import { upsertRecurringBillingScheduleForPayment } from "@/lib/recurring-billing-schedule";
import {
  buildPaymentSyncMetadata,
  hasPaymentChargeback,
  type PaymentSyncType,
} from "@/lib/reliability/payment-sync-record";
import type { RecurringCollectionState } from "@/lib/recurring-billing-policy";

export type SyncActor = {
  email?: string | null;
  kind: "system" | "user";
};

type LocalPaymentRow = {
  id: string;
};

type PersistSyncedPaymentInput = {
  actor: SyncActor;
  collectionReviewRequiredAt: string | null;
  customerId: string | null;
  localMandateId: string | null;
  localSubscriptionId: string | null;
  mode: MollieMode;
  payment: Payment;
  paymentType: PaymentSyncType;
  recurringCollectionState: RecurringCollectionState;
};

export async function persistSyncedPayment(
  client: DbClient,
  input: PersistSyncedPaymentInput,
) {
  const existingPayment = await client.execute<LocalPaymentRow>(sql`
      select id
      from payments
      where mode = ${input.mode} and mollie_payment_id = ${input.payment.id}
      limit 1
    `);
  const localPaymentId = existingPayment.rows[0]?.id ?? crypto.randomUUID();

  await client.execute(sql`
      insert into payments (
        id,
        customer_id,
        subscription_id,
        mandate_id,
        mode,
        payment_type,
        mollie_payment_id,
        mollie_status,
        sequence_type,
        method,
        amount_value,
        amount_currency,
        checkout_url,
        expires_at,
        paid_at,
        failed_at,
        disputed_at,
        recurring_collection_state,
        collection_review_required_at,
        metadata,
        created_at,
        updated_at,
        last_synced_at
      ) values (
        ${localPaymentId},
        ${input.customerId},
        ${input.localSubscriptionId},
        ${input.localMandateId},
        ${input.mode},
        ${input.paymentType},
        ${input.payment.id},
        ${input.payment.status},
        ${input.payment.sequenceType},
        ${input.payment.method ?? null},
        ${input.payment.amount.value},
        ${input.payment.amount.currency},
        ${input.payment.getCheckoutUrl()},
        ${input.payment.expiresAt ?? null}::timestamptz,
        ${input.payment.paidAt ?? null}::timestamptz,
        ${input.payment.failedAt ?? null}::timestamptz,
        ${hasPaymentChargeback(input.payment) ? new Date().toISOString() : null}::timestamptz,
        ${input.recurringCollectionState},
        ${input.collectionReviewRequiredAt}::timestamptz,
        ${JSON.stringify(
          buildPaymentSyncMetadata({
            payment: input.payment,
            paymentType: input.paymentType,
          }),
        )}::jsonb,
        ${input.payment.createdAt}::timestamptz,
        now(),
        now()
      )
      on conflict (mode, mollie_payment_id)
      do update set
        customer_id = excluded.customer_id,
        subscription_id = excluded.subscription_id,
        mandate_id = excluded.mandate_id,
        payment_type = excluded.payment_type,
        mollie_status = excluded.mollie_status,
        sequence_type = excluded.sequence_type,
        method = excluded.method,
        amount_value = excluded.amount_value,
        amount_currency = excluded.amount_currency,
        checkout_url = excluded.checkout_url,
        expires_at = excluded.expires_at,
        paid_at = excluded.paid_at,
        failed_at = excluded.failed_at,
        disputed_at = excluded.disputed_at,
        recurring_collection_state = excluded.recurring_collection_state,
        collection_review_required_at = case
          when excluded.collection_review_required_at is null then null
          else coalesce(payments.collection_review_required_at, excluded.collection_review_required_at)
        end,
        metadata = excluded.metadata,
        updated_at = now(),
        last_synced_at = now()
    `);

  if (input.paymentType === "recurring" && input.localSubscriptionId) {
    await upsertRecurringBillingScheduleForPayment(client, {
      amountCurrency: input.payment.amount.currency,
      amountValue: input.payment.amount.value,
      collectionState: input.recurringCollectionState,
      mode: input.mode,
      paymentCreatedAt: input.payment.createdAt,
      paymentId: localPaymentId,
      subscriptionId: input.localSubscriptionId,
    });
  }

  await writeAuditLog(
    {
      action: "payment.sync",
      details: {
        localPaymentId,
        molliePaymentId: input.payment.id,
        mollieStatus: input.payment.status,
        recurringCollectionState: input.recurringCollectionState,
      },
      entityId: localPaymentId,
      entityType: "payment",
      mode: input.mode,
      outcome: "success",
      summary: "Refreshed a payment from Mollie.",
    },
    client,
    input.actor,
  );

  return localPaymentId;
}
