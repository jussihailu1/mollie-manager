import "server-only";

import { MandateStatus, type Payment } from "@mollie/api-client";
import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import { getDb, transaction, type DbClient, type DbTransaction } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import { getMollieClient, isMollieConfigured } from "@/lib/mollie/client";
import { attemptSubscriptionActivation } from "@/lib/onboarding/subscription-activation";
import { runFirstPaymentInvoiceSyncFollowUp } from "@/lib/reliability/first-payment-sync-followup";
import {
  type ReconciliationSummary,
} from "@/lib/reliability/reconciliation-summary";
import {
  buildPaymentLinkSyncMetadata,
  derivePaymentLinkSyncAmount,
  derivePaymentLinkSyncStatus,
  type PaymentLinkSyncSource,
} from "@/lib/reliability/payment-link-sync-record";
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
    } satisfies LocalCustomerLink;
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
