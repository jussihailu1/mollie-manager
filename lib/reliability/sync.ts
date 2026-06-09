import "server-only";

import { MandateStatus, type Payment } from "@mollie/api-client";
import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import { getDb, transaction, type DbClient, type DbTransaction } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import { getMollieClient, isMollieConfigured } from "@/lib/mollie/client";
import { attemptSubscriptionActivation } from "@/lib/onboarding/subscription-activation";
import {
  createEboekhoudenInvoiceForFirstPayment,
  normalizeFirstPaymentInvoiceStates,
} from "@/lib/eboekhouden/first-payment-invoices";
import {
  upsertRecurringBillingScheduleForPayment,
  upsertRecurringBillingScheduleForSubscription,
} from "@/lib/recurring-billing-schedule";
import {
  buildInvoiceStateDeltaSummary,
  FIRST_PAYMENT_INVOICE_STATES,
  mapInvoiceStateCounts,
  RECURRING_INVOICE_STATES,
  type FirstPaymentInvoiceState,
  type InvoiceStateCountMap,
  type ReconciliationSummary,
  type RecurringInvoiceState,
} from "@/lib/reliability/reconciliation-summary";
import {
  buildPaymentLinkSyncMetadata,
  derivePaymentLinkSyncAmount,
  derivePaymentLinkSyncStatus,
  type PaymentLinkSyncSource,
} from "@/lib/reliability/payment-link-sync-record";
import {
  buildPaymentSyncMetadata,
  deriveCollectionReviewRequiredAt,
  derivePaymentRecurringCollectionState,
  hasPaymentChargeback,
  resolveFirstPaymentMode,
  resolvePaymentSyncType,
} from "@/lib/reliability/payment-sync-record";
import {
  handlePaymentAlerts,
  handleSubscriptionAlerts,
} from "@/lib/reliability/sync-alerts";
import { buildConfiguredMollieModeOrder } from "@/lib/reliability/mollie-mode-selection";
import {
  buildSubscriptionSyncMetadata,
  deriveSubscriptionBillingDay,
  shouldStopSubscriptionAfterCurrentPeriod,
} from "@/lib/reliability/subscription-sync-record";
import { findMollieResourceAcrossModes } from "@/lib/reliability/mollie-resource-lookup";
import { mapSubscriptionLifecycle } from "@/lib/subscriptions";

type MolliePaymentLink = {
  createdAt?: string;
  description: string;
  expiresAt?: string;
  getPaymentUrl: () => string;
  getPayments: () => AsyncIterable<Payment>;
  id: string;
  webhookUrl?: string;
} & PaymentLinkSyncSource;

type SyncActor = {
  email?: string | null;
  kind: "system" | "user";
};

export type ReconciliationMode = "full" | "sync_only";

type LocalCustomerLink = {
  id: string;
  mollieCustomerId: string | null;
  mode: MollieMode;
};

type LocalSubscriptionLink = {
  customerId: string;
  customerMollieId: string | null;
  id: string;
  localStatus: string;
  mandateId: string | null;
  metadata: Record<string, unknown>;
  mode: MollieMode;
  mollieSubscriptionId: string | null;
  subscriptionTermMode: "fixed_term" | "open_ended";
  totalPayments: number | null;
};

type LocalPaymentRow = {
  id: string;
};

type LocalStoredPaymentLink = {
  customerId: string | null;
  id: string;
  metadata: Record<string, unknown>;
  molliePaymentLinkId: string | null;
};

type LocalMandateLink = {
  id: string;
};

type WebhookProcessingResult = {
  customerId: string | null;
  paymentId: string | null;
  paymentLinkId: string | null;
  subscriptionId: string | null;
};

type InvoiceStateCountRow<TState extends string> = {
  count: number | string;
  state: TState;
};

async function getFirstPaymentInvoiceStateCounts(
  mode?: MollieMode | null,
): Promise<InvoiceStateCountMap<FirstPaymentInvoiceState>> {
  const modeParam = mode ?? null;
  const result = await getDb().execute<InvoiceStateCountRow<FirstPaymentInvoiceState>>(sql`
      select
        invoice_state as state,
        count(*)::int as count
      from payments
      where payment_type = 'first'
        and (${modeParam}::mollie_mode is null or mode = ${modeParam})
      group by invoice_state
    `);

  return mapInvoiceStateCounts(FIRST_PAYMENT_INVOICE_STATES, result.rows);
}

async function getRecurringInvoiceStateCounts(
  mode?: MollieMode | null,
): Promise<InvoiceStateCountMap<RecurringInvoiceState>> {
  const modeParam = mode ?? null;
  const result = await getDb().execute<InvoiceStateCountRow<RecurringInvoiceState>>(sql`
      select
        invoice_state as state,
        count(*)::int as count
      from recurring_billing_schedules
      where (${modeParam}::mollie_mode is null or mode = ${modeParam})
      group by invoice_state
    `);

  return mapInvoiceStateCounts(RECURRING_INVOICE_STATES, result.rows);
}

function buildModesToTry(preferredMode?: MollieMode, strictMode = false) {
  return buildConfiguredMollieModeOrder({
    isConfigured: isMollieConfigured,
    preferredMode,
    strictMode,
  });
}

async function findPaymentAcrossModes(
  molliePaymentId: string,
  preferredMode?: MollieMode,
  strictMode = false,
) {
  const result = await findMollieResourceAcrossModes(
    buildModesToTry(preferredMode, strictMode),
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
    buildModesToTry(preferredMode, strictMode),
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
    buildModesToTry(preferredMode, strictMode),
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

async function getLocalCustomerByMollieId(
  mode: MollieMode,
  mollieCustomerId: string | undefined,
) {
  if (!mollieCustomerId) {
    return null;
  }

  const result = await getDb().execute<LocalCustomerLink>(sql`
      select
        id,
        mode,
        mollie_customer_id as "mollieCustomerId"
      from customers
      where mode = ${mode} and mollie_customer_id = ${mollieCustomerId}
      limit 1
    `);

  return result.rows[0] ?? null;
}

export async function getManagedSubscription(subscriptionId: string) {
  const result = await getDb().execute<LocalSubscriptionLink>(sql`
      select
        s.id,
        s.mode,
        s.local_status as "localStatus",
        s.mandate_id as "mandateId",
        s.mollie_subscription_id as "mollieSubscriptionId",
        s.subscription_term_mode as "subscriptionTermMode",
        s.total_payments as "totalPayments",
        s.metadata,
        c.id as "customerId",
        c.mollie_customer_id as "customerMollieId"
      from subscriptions s
      inner join customers c on c.id = s.customer_id
      where s.id = ${subscriptionId}
      limit 1
    `);

  return result.rows[0] ?? null;
}

async function getManagedSubscriptionByMollieId(
  mode: MollieMode,
  mollieSubscriptionId: string | undefined,
) {
  if (!mollieSubscriptionId) {
    return null;
  }

  const result = await getDb().execute<LocalSubscriptionLink>(sql`
      select
        s.id,
        s.mode,
        s.local_status as "localStatus",
        s.mandate_id as "mandateId",
        s.mollie_subscription_id as "mollieSubscriptionId",
        s.subscription_term_mode as "subscriptionTermMode",
        s.total_payments as "totalPayments",
        s.metadata,
        c.id as "customerId",
        c.mollie_customer_id as "customerMollieId"
      from subscriptions s
      inner join customers c on c.id = s.customer_id
      where s.mode = ${mode} and s.mollie_subscription_id = ${mollieSubscriptionId}
      limit 1
    `);

  return result.rows[0] ?? null;
}

async function getLocalPaymentLinkByMollieId(
  mode: MollieMode,
  molliePaymentLinkId: string,
  client?: DbClient,
) {
  const db = client ?? getDb();
  const result = await db.execute<LocalStoredPaymentLink>(sql`
      select
        id,
        customer_id as "customerId",
        metadata,
        mollie_payment_link_id as "molliePaymentLinkId"
      from payment_links
      where mode = ${mode} and mollie_payment_link_id = ${molliePaymentLinkId}
      limit 1
    `);

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    ...row,
    metadata:
      typeof row.metadata === "object" && row.metadata !== null ? row.metadata : {},
  } satisfies LocalStoredPaymentLink;
}

async function findLocalMandateId(
  mode: MollieMode,
  mollieMandateId: string | undefined,
  client?: DbClient,
) {
  if (!mollieMandateId) {
    return null;
  }

  const db = client ?? getDb();
  const result = await db.execute<LocalMandateLink>(sql`
    select id
    from mandates
    where mode = ${mode} and mollie_mandate_id = ${mollieMandateId}
    limit 1
  `);

  return result.rows[0]?.id ?? null;
}

async function upsertMandatesForCustomer(
  client: DbTransaction,
  customer: LocalCustomerLink,
) {
  if (!customer.mollieCustomerId) {
    return new Map<string, string>();
  }

  const mandates = await getMollieClient(customer.mode).customerMandates.page({
    customerId: customer.mollieCustomerId,
  });
  const mandateIdMap = new Map<string, string>();

  for (const mandate of mandates) {
    const existing = await client.execute<LocalMandateLink>(sql`
        select id
        from mandates
        where mode = ${customer.mode} and mollie_mandate_id = ${mandate.id}
        limit 1
      `);
    const localMandateId = existing.rows[0]?.id ?? crypto.randomUUID();

    await client.execute(sql`
        insert into mandates (
          id,
          customer_id,
          mode,
          mollie_mandate_id,
          method,
          mollie_status,
          is_valid,
          details,
          created_at,
          updated_at,
          last_synced_at
        ) values (
          ${localMandateId},
          ${customer.id},
          ${customer.mode},
          ${mandate.id},
          ${mandate.method ?? null},
          ${mandate.status},
          ${mandate.status === MandateStatus.valid},
          ${JSON.stringify(
            typeof mandate.details === "object" && mandate.details !== null
              ? mandate.details
              : {},
          )}::jsonb,
          coalesce(${mandate.createdAt ?? null}::timestamptz, now()),
          now(),
          now()
        )
        on conflict (mode, mollie_mandate_id)
        do update set
          customer_id = excluded.customer_id,
          method = excluded.method,
          mollie_status = excluded.mollie_status,
          is_valid = excluded.is_valid,
          details = excluded.details,
          updated_at = now(),
          last_synced_at = now()
      `);

    mandateIdMap.set(mandate.id, localMandateId);
  }

  return mandateIdMap;
}

async function collectPaymentLinkPayments(paymentLink: MolliePaymentLink) {
  const payments: Payment[] = [];

  for await (const payment of paymentLink.getPayments()) {
    payments.push(payment);

    if (payments.length >= 50) {
      break;
    }
  }

  return payments;
}

function shouldRunBillingFollowups(mode: ReconciliationMode) {
  return mode === "full";
}

async function upsertPaymentLinkFromMollie(
  mode: MollieMode,
  paymentLink: MolliePaymentLink,
  payments: Payment[],
  options: {
    actor: SyncActor;
    customerId?: string | null;
  },
) {
  const linkedCustomer =
    options.customerId ??
    (await getLocalCustomerByMollieId(mode, paymentLink.customerId))?.id ??
    null;
  const paymentLinkAmount = derivePaymentLinkSyncAmount(paymentLink, payments);
  const paymentLinkStatus = derivePaymentLinkSyncStatus(paymentLink, payments);
  let localPaymentLinkId = crypto.randomUUID();

  await transaction(async (client) => {
    const existingPaymentLink = await getLocalPaymentLinkByMollieId(
      mode,
      paymentLink.id,
      client,
    );
    localPaymentLinkId = existingPaymentLink?.id ?? localPaymentLinkId;

    await client.execute(sql`
        insert into payment_links (
          id,
          customer_id,
          mode,
          mollie_payment_link_id,
          mollie_status,
          description,
          amount_value,
          amount_currency,
          checkout_url,
          expires_at,
          metadata,
          created_at,
          updated_at,
          last_synced_at
        ) values (
          ${localPaymentLinkId},
          ${linkedCustomer ?? existingPaymentLink?.customerId ?? null},
          ${mode},
          ${paymentLink.id},
          ${paymentLinkStatus},
          ${paymentLink.description},
          ${paymentLinkAmount.value},
          ${paymentLinkAmount.currency},
          ${paymentLink.getPaymentUrl()},
          ${paymentLink.expiresAt ?? null}::timestamptz,
          ${JSON.stringify(
            buildPaymentLinkSyncMetadata({
              existingMetadata: existingPaymentLink?.metadata,
              paymentLink,
              payments,
            }),
          )}::jsonb,
          coalesce(${paymentLink.createdAt ?? null}::timestamptz, now()),
          now(),
          now()
        )
        on conflict (mode, mollie_payment_link_id)
        do update set
          customer_id = coalesce(excluded.customer_id, payment_links.customer_id),
          mollie_status = excluded.mollie_status,
          description = excluded.description,
          amount_value = excluded.amount_value,
          amount_currency = excluded.amount_currency,
          checkout_url = excluded.checkout_url,
          expires_at = excluded.expires_at,
          metadata = excluded.metadata,
          updated_at = now(),
          last_synced_at = now()
      `);

    await writeAuditLog(
      {
        action: "payment_link.sync",
        details: {
          localPaymentLinkId,
          molliePaymentLinkId: paymentLink.id,
          paymentCount: payments.length,
          paymentLinkStatus,
        },
        entityId: localPaymentLinkId,
        entityType: "payment_link",
        mode,
        outcome: "success",
        summary: "Refreshed a payment link from Mollie.",
      },
      client,
      options.actor,
    );
  });

  return localPaymentLinkId;
}

async function syncMatchingPaymentLinkForPayment(
  mode: MollieMode,
  payment: Payment,
  customerId: string | null,
  actor: SyncActor,
) {
  if (!customerId && !payment.customerId) {
    return null;
  }

  const candidates = await getDb().execute<LocalStoredPaymentLink>(sql`
      select
        id,
        customer_id as "customerId",
        mollie_payment_link_id as "molliePaymentLinkId"
      from payment_links
      where
        mode = ${mode}
        and mollie_payment_link_id is not null
        and metadata ->> 'source' = 'subscription_onboarding'
        and metadata ->> 'paymentType' = 'first'
        and (
          customer_id = ${customerId}
          or metadata ->> 'mollieCustomerId' = ${payment.customerId ?? null}
        )
      order by created_at desc
      limit 10
    `);

  for (const candidate of candidates.rows) {
    if (!candidate.molliePaymentLinkId) {
      continue;
    }

    const paymentLink = (await getMollieClient(mode).paymentLinks.get(
      candidate.molliePaymentLinkId,
    )) as unknown as MolliePaymentLink;
    const payments = await collectPaymentLinkPayments(paymentLink);

    if (!payments.some((linkedPayment) => linkedPayment.id === payment.id)) {
      continue;
    }

    return upsertPaymentLinkFromMollie(mode, paymentLink, payments, {
      actor,
      customerId: candidate.customerId ?? customerId,
    });
  }

  return null;
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
    const existingPayment = await client.execute<LocalPaymentRow>(sql`
        select id
        from payments
        where mode = ${mode} and mollie_payment_id = ${payment.id}
        limit 1
      `);
    localPaymentId = existingPayment.rows[0]?.id ?? localPaymentId;

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
          ${resolvedCustomerId},
          ${localSubscription?.id ?? null},
          ${localMandateId},
          ${mode},
          ${paymentType},
          ${payment.id},
          ${payment.status},
          ${payment.sequenceType},
          ${payment.method ?? null},
          ${payment.amount.value},
          ${payment.amount.currency},
          ${payment.getCheckoutUrl()},
          ${payment.expiresAt ?? null}::timestamptz,
          ${payment.paidAt ?? null}::timestamptz,
          ${payment.failedAt ?? null}::timestamptz,
          ${hasPaymentChargeback(payment) ? new Date().toISOString() : null}::timestamptz,
          ${recurringCollectionState},
          ${collectionReviewRequiredAt}::timestamptz,
          ${JSON.stringify(buildPaymentSyncMetadata({ payment, paymentType }))}::jsonb,
          ${payment.createdAt}::timestamptz,
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

    if (paymentType === "recurring" && localSubscription) {
      await upsertRecurringBillingScheduleForPayment(client, {
        amountCurrency: payment.amount.currency,
        amountValue: payment.amount.value,
        collectionState: recurringCollectionState,
        mode,
        paymentCreatedAt: payment.createdAt,
        paymentId: localPaymentId,
        subscriptionId: localSubscription.id,
      });
    }

    await writeAuditLog(
      {
        action: "payment.sync",
        details: {
          localPaymentId,
          molliePaymentId: payment.id,
          mollieStatus: payment.status,
          recurringCollectionState,
        },
        entityId: localPaymentId,
        entityType: "payment",
        mode,
        outcome: "success",
        summary: "Refreshed a payment from Mollie.",
      },
      client,
      actor,
    );
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
    await normalizeFirstPaymentInvoiceStates({
      mode,
      paymentId: localPaymentId,
    });

    if (payment.status === "paid" && shouldRunBillingFollowups(reconciliationMode)) {
      try {
        await createEboekhoudenInvoiceForFirstPayment(localPaymentId, {
          actor,
        });
      } catch (error) {
        await writeAuditLog(
          {
            action: "first_payment_invoice.auto_create",
            details: {
              error: error instanceof Error ? error.message : String(error),
              paymentId: localPaymentId,
            },
            entityId: localPaymentId,
            entityType: "payment",
            mode,
            outcome: "failure",
            summary:
              "Automatic first-payment invoice create skipped or failed after paid sync.",
          },
          undefined,
          actor,
        );
      }
    }
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
  const normalizedFirstPayments: { id: string; isPaid: boolean }[] = [];

  await transaction(async (client) => {
    const localCustomer = {
      id: localSubscription.customerId,
      mollieCustomerId: localSubscription.customerMollieId,
      mode: localSubscription.mode,
    } satisfies LocalCustomerLink;
    const mandateIdMap = await upsertMandatesForCustomer(client, localCustomer);
    const localMandateId =
      (subscription.mandateId
        ? mandateIdMap.get(subscription.mandateId) ?? null
        : null) ??
      (await findLocalMandateId(localSubscription.mode, subscription.mandateId, client));
    const localStatus = mapSubscriptionLifecycle(subscription.status);

    await client.execute(sql`
        update subscriptions
        set
          mandate_id = ${localMandateId},
          local_status = ${localStatus},
          mollie_status = ${subscription.status},
          description = ${subscription.description},
          interval = ${subscription.interval},
          amount_value = ${subscription.amount.value},
          amount_currency = ${subscription.amount.currency},
          billing_day = ${deriveSubscriptionBillingDay(subscription)},
          start_date = ${subscription.startDate}::date,
          stop_after_current_period = ${shouldStopSubscriptionAfterCurrentPeriod(subscription)},
          canceled_at = ${subscription.canceledAt ?? null}::timestamptz,
          metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(buildSubscriptionSyncMetadata(subscription))}::jsonb,
          updated_at = now(),
          last_synced_at = now()
        where id = ${localSubscription.id}
      `);

    await upsertRecurringBillingScheduleForSubscription(client, {
      actor,
      amountCurrency: subscription.amount.currency,
      amountValue: subscription.amount.value,
      firstPaymentMode: resolveFirstPaymentMode(localSubscription.metadata),
      interval: subscription.interval,
      mode: localSubscription.mode,
      nextPaymentDate: subscription.nextPaymentDate ?? null,
      periodLimit: 1,
      startDate: null,
      subscriptionId: localSubscription.id,
      subscriptionTermMode: localSubscription.subscriptionTermMode,
      totalPayments: localSubscription.totalPayments,
    });

    for (const payment of payments) {
      const existingPayment = await client.execute<LocalPaymentRow>(sql`
          select id
          from payments
          where mode = ${localSubscription.mode} and mollie_payment_id = ${payment.id}
          limit 1
        `);
      const linkedMandateId =
        (payment.mandateId ? mandateIdMap.get(payment.mandateId) ?? null : null) ??
        (await findLocalMandateId(localSubscription.mode, payment.mandateId, client)) ??
        localMandateId ??
        null;
      const localPaymentId = existingPayment.rows[0]?.id ?? crypto.randomUUID();
      const paymentType = resolvePaymentSyncType(payment);
      const recurringCollectionState = derivePaymentRecurringCollectionState(payment);
      const collectionReviewRequiredAt = deriveCollectionReviewRequiredAt(
        recurringCollectionState,
      );

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
            ${localSubscription.customerId},
            ${localSubscription.id},
            ${linkedMandateId},
            ${localSubscription.mode},
            ${paymentType},
            ${payment.id},
            ${payment.status},
            ${payment.sequenceType},
            ${payment.method ?? null},
            ${payment.amount.value},
            ${payment.amount.currency},
            ${payment.getCheckoutUrl()},
            ${payment.expiresAt ?? null}::timestamptz,
            ${payment.paidAt ?? null}::timestamptz,
            ${payment.failedAt ?? null}::timestamptz,
            ${hasPaymentChargeback(payment) ? new Date().toISOString() : null}::timestamptz,
            ${recurringCollectionState},
            ${collectionReviewRequiredAt}::timestamptz,
            ${JSON.stringify(buildPaymentSyncMetadata({ payment, paymentType }))}::jsonb,
            ${payment.createdAt}::timestamptz,
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

      if (paymentType === "recurring") {
        await upsertRecurringBillingScheduleForPayment(client, {
          amountCurrency: payment.amount.currency,
          amountValue: payment.amount.value,
          collectionState: recurringCollectionState,
          mode: localSubscription.mode,
          paymentCreatedAt: payment.createdAt,
          paymentId: localPaymentId,
          subscriptionId: localSubscription.id,
        });
      }

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
          localSubscriptionId: localSubscription.id,
          mollieSubscriptionId: localSubscription.mollieSubscriptionId,
          paymentCount: payments.length,
        },
        entityId: localSubscription.id,
        entityType: "subscription",
        mode: localSubscription.mode,
        outcome: "success",
        summary: "Refreshed the subscription and its payments from Mollie.",
      },
      client,
      actor,
    );
  });

  for (const payment of payments) {
    const syncedPayment = await getDb().execute<LocalPaymentRow>(sql`
        select id
        from payments
        where mode = ${localSubscription.mode} and mollie_payment_id = ${payment.id}
        limit 1
      `);

    if (syncedPayment.rows[0]?.id) {
      await handlePaymentAlerts({
        customerId: localSubscription.customerId,
        localPaymentId: syncedPayment.rows[0].id,
        payment,
        subscriptionId: localSubscription.id,
      });
    }
  }

  for (const firstPayment of normalizedFirstPayments) {
    await normalizeFirstPaymentInvoiceStates({
      mode: localSubscription.mode,
      paymentId: firstPayment.id,
    });

    if (!firstPayment.isPaid || !shouldRunBillingFollowups(reconciliationMode)) {
      continue;
    }

    try {
      await createEboekhoudenInvoiceForFirstPayment(firstPayment.id, {
        actor,
      });
    } catch (error) {
      await writeAuditLog(
        {
          action: "first_payment_invoice.auto_create",
          details: {
            error: error instanceof Error ? error.message : String(error),
            paymentId: firstPayment.id,
          },
          entityId: firstPayment.id,
          entityType: "payment",
          mode: localSubscription.mode,
          outcome: "failure",
          summary:
            "Automatic first-payment invoice create skipped or failed after subscription sync.",
        },
        undefined,
        actor,
      );
    }
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
  const effectiveActor = input?.actor ?? {
    kind: "system" as const,
  };
  const modeParam = input?.mode ?? null;
  const reconciliationMode = input?.reconciliationMode ?? "full";
  const [
    beforeFirstPaymentInvoiceStates,
    beforeRecurringInvoiceStates,
    subscriptions,
    firstPayments,
    paymentLinks,
  ] = await Promise.all([
    getFirstPaymentInvoiceStateCounts(modeParam),
    getRecurringInvoiceStateCounts(modeParam),
    getDb().execute<{ id: string }>(sql`
      select id
      from subscriptions
      where (${modeParam}::mollie_mode is null or mode = ${modeParam})
      order by created_at desc
    `),
    getDb().execute<{ molliePaymentId: string }>(sql`
      select mollie_payment_id as "molliePaymentId"
      from payments
      where payment_type = 'first'
        and mollie_payment_id is not null
        and (${modeParam}::mollie_mode is null or mode = ${modeParam})
      order by created_at desc
    `),
    getDb().execute<{ molliePaymentLinkId: string }>(sql`
      select mollie_payment_link_id as "molliePaymentLinkId"
      from payment_links
      where mollie_payment_link_id is not null
        and (${modeParam}::mollie_mode is null or mode = ${modeParam})
        and metadata ->> 'source' = 'subscription_onboarding'
        and metadata ->> 'paymentType' = 'first'
      order by created_at desc
    `),
  ]);

  for (const subscription of subscriptions.rows) {
    await syncSubscriptionByLocalId(subscription.id, {
      actor: effectiveActor,
      reconciliationMode,
      strictMode: Boolean(input?.mode),
    });
  }

  for (const paymentLink of paymentLinks.rows) {
    await syncPaymentLinkByMollieId(paymentLink.molliePaymentLinkId, {
      actor: effectiveActor,
      preferredMode: input?.mode,
      strictMode: Boolean(input?.mode),
    });
  }

  for (const payment of firstPayments.rows) {
    await syncPaymentByMollieId(payment.molliePaymentId, {
      actor: effectiveActor,
      preferredMode: input?.mode,
      reconciliationMode,
      strictMode: Boolean(input?.mode),
    });
  }

  const [afterFirstPaymentInvoiceStates, afterRecurringInvoiceStates] =
    await Promise.all([
      getFirstPaymentInvoiceStateCounts(modeParam),
      getRecurringInvoiceStateCounts(modeParam),
    ]);

  const result: ReconciliationSummary = {
    firstPaymentInvoiceStateDelta: buildInvoiceStateDeltaSummary(
      FIRST_PAYMENT_INVOICE_STATES,
      beforeFirstPaymentInvoiceStates,
      afterFirstPaymentInvoiceStates,
    ),
    firstPaymentsChecked: firstPayments.rows.length,
    mode: modeParam,
    paymentLinksChecked: paymentLinks.rows.length,
    ranAt: new Date().toISOString(),
    reconciliationMode,
    recurringInvoiceStateDelta: buildInvoiceStateDeltaSummary(
      RECURRING_INVOICE_STATES,
      beforeRecurringInvoiceStates,
      afterRecurringInvoiceStates,
    ),
    subscriptionsChecked: subscriptions.rows.length,
  };

  await writeAuditLog(
    {
      action: "reconciliation.run",
      details: {
        firstPaymentCount: result.firstPaymentsChecked,
        firstPaymentInvoiceStateDelta: result.firstPaymentInvoiceStateDelta,
        paymentLinkCount: result.paymentLinksChecked,
        ranAt: result.ranAt,
        reconciliationMode,
        recurringInvoiceStateDelta: result.recurringInvoiceStateDelta,
        subscriptionCount: result.subscriptionsChecked,
      },
      entityId: "system",
      entityType: "reconciliation",
      mode: input?.mode,
      outcome: "success",
      summary:
        reconciliationMode === "sync_only"
          ? "Completed a sync-only reconciliation pass against Mollie."
          : "Completed a full reconciliation pass against Mollie.",
    },
    undefined,
    effectiveActor,
  );

  return result;
}
