import "server-only";

import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import type { DbClient } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import {
  addRecurringBillingInterval,
  DEFAULT_RECURRING_BILLING_POLICY,
  deriveInvoiceSendDueDate,
  isCollectionReviewState,
  type RecurringCollectionState,
} from "@/lib/recurring-billing-policy";

type BillingScheduleActor = {
  email?: string | null;
  kind: "system" | "user";
};

type FirstPaymentMode = "mandate_only" | "real_installment";
type SubscriptionTermMode = "fixed_term" | "open_ended";

type ScheduleSubscriptionInput = {
  amountCurrency: string;
  amountValue: string;
  firstPaymentMode: FirstPaymentMode;
  interval: string;
  mode: MollieMode;
  nextPaymentDate?: string | null;
  periodLimit?: number;
  startDate: string | null;
  subscriptionId: string;
  subscriptionTermMode: SubscriptionTermMode;
  totalPayments: number | null;
};

type SchedulePaymentInput = {
  amountCurrency: string;
  amountValue: string;
  collectionState: RecurringCollectionState;
  mode: MollieMode;
  paymentCreatedAt: string;
  paymentId: string;
  subscriptionId: string;
};

function toDateString(value: string) {
  return value.slice(0, 10);
}

function getRecurringPeriodCount(input: {
  firstPaymentMode: FirstPaymentMode;
  subscriptionTermMode: SubscriptionTermMode;
  totalPayments: number | null;
}) {
  if (input.subscriptionTermMode === "open_ended") {
    return 1;
  }

  if (input.totalPayments === null) {
    return 0;
  }

  if (input.firstPaymentMode === "mandate_only") {
    return input.totalPayments;
  }

  return Math.max(input.totalPayments - 1, 0);
}

export function buildRecurringBillingScheduleEntries(
  input: ScheduleSubscriptionInput,
) {
  const firstPlannedCollectionDate = toDateString(
    input.nextPaymentDate ?? input.startDate ?? "",
  );

  if (!firstPlannedCollectionDate) {
    return [];
  }

  const periodCount = getRecurringPeriodCount({
    firstPaymentMode: input.firstPaymentMode,
    subscriptionTermMode: input.subscriptionTermMode,
    totalPayments: input.totalPayments,
  });
  const limitedPeriodCount = input.periodLimit
    ? Math.min(periodCount, input.periodLimit)
    : periodCount;
  const entries: {
    amountCurrency: string;
    amountValue: string;
    billingPeriodIndex: number;
    invoiceNoticeDaysBeforeDueDate: number;
    invoiceSendDueDate: string;
    plannedCollectionDate: string;
  }[] = [];
  let plannedCollectionDate = firstPlannedCollectionDate;

  for (let index = 1; index <= limitedPeriodCount; index += 1) {
    entries.push({
      amountCurrency: input.amountCurrency,
      amountValue: input.amountValue,
      billingPeriodIndex: index,
      invoiceNoticeDaysBeforeDueDate:
        DEFAULT_RECURRING_BILLING_POLICY.invoiceNoticeDaysBeforeDueDate,
      invoiceSendDueDate: deriveInvoiceSendDueDate({
        plannedCollectionDate,
      }),
      plannedCollectionDate,
    });

    plannedCollectionDate = addRecurringBillingInterval(
      plannedCollectionDate,
      input.interval,
    );
  }

  return entries;
}

export async function upsertRecurringBillingScheduleForSubscription(
  client: DbClient,
  input: ScheduleSubscriptionInput & {
    actor?: BillingScheduleActor;
  },
) {
  const entries = buildRecurringBillingScheduleEntries(input);

  for (const entry of entries) {
    await client.execute(sql`
      insert into recurring_billing_schedules (
        id,
        subscription_id,
        mode,
        planned_collection_date,
        invoice_send_due_date,
        invoice_notice_days_before_due_date,
        invoice_state,
        collection_state,
        amount_value,
        amount_currency,
        billing_period_index,
        metadata,
        created_at,
        updated_at
      ) values (
        ${crypto.randomUUID()},
        ${input.subscriptionId},
        ${input.mode},
        ${entry.plannedCollectionDate}::date,
        ${entry.invoiceSendDueDate}::date,
        ${entry.invoiceNoticeDaysBeforeDueDate},
        'pending_invoice',
        'not_applicable',
        ${entry.amountValue},
        ${entry.amountCurrency},
        ${entry.billingPeriodIndex},
        ${JSON.stringify({
          source: "subscription_schedule",
        })}::jsonb,
        now(),
        now()
      )
      on conflict (subscription_id, planned_collection_date)
      do update set
        invoice_send_due_date = excluded.invoice_send_due_date,
        invoice_notice_days_before_due_date = excluded.invoice_notice_days_before_due_date,
        amount_value = excluded.amount_value,
        amount_currency = excluded.amount_currency,
        billing_period_index = coalesce(recurring_billing_schedules.billing_period_index, excluded.billing_period_index),
        updated_at = now()
    `);
  }

  if (entries.length > 0) {
    await writeAuditLog(
      {
        action: "recurring_billing.schedule.upsert",
        details: {
          scheduleCount: entries.length,
        },
        entityId: input.subscriptionId,
        entityType: "subscription",
        mode: input.mode,
        outcome: "success",
        summary: "Prepared recurring billing schedule rows for the subscription.",
      },
      client,
      input.actor,
    );
  }

  return entries.length;
}

export async function upsertRecurringBillingScheduleForPayment(
  client: DbClient,
  input: SchedulePaymentInput,
) {
  const plannedCollectionDate = toDateString(input.paymentCreatedAt);
  const invoiceSendDueDate = deriveInvoiceSendDueDate({
    plannedCollectionDate,
  });
  const collectionResolvedAt =
    input.collectionState === "settled" || isCollectionReviewState(input.collectionState)
      ? new Date().toISOString()
      : null;

  await client.execute(sql`
    insert into recurring_billing_schedules (
      id,
      subscription_id,
      mode,
      planned_collection_date,
      invoice_send_due_date,
      invoice_notice_days_before_due_date,
      invoice_state,
      collection_state,
      payment_id,
      amount_value,
      amount_currency,
      metadata,
      collection_resolved_at,
      created_at,
      updated_at
    ) values (
      ${crypto.randomUUID()},
      ${input.subscriptionId},
      ${input.mode},
      ${plannedCollectionDate}::date,
      ${invoiceSendDueDate}::date,
      ${DEFAULT_RECURRING_BILLING_POLICY.invoiceNoticeDaysBeforeDueDate},
      'pending_invoice',
      ${input.collectionState},
      ${input.paymentId},
      ${input.amountValue},
      ${input.amountCurrency},
      ${JSON.stringify({
        source: "mollie_recurring_payment",
      })}::jsonb,
      ${collectionResolvedAt}::timestamptz,
      now(),
      now()
    )
    on conflict (subscription_id, planned_collection_date)
    do update set
      collection_state = excluded.collection_state,
      payment_id = excluded.payment_id,
      amount_value = excluded.amount_value,
      amount_currency = excluded.amount_currency,
      collection_resolved_at = case
        when excluded.collection_resolved_at is null then recurring_billing_schedules.collection_resolved_at
        else coalesce(recurring_billing_schedules.collection_resolved_at, excluded.collection_resolved_at)
      end,
      updated_at = now()
  `);
}
