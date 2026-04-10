import "server-only";

import { MandateStatus, type Payment } from "@mollie/api-client";
import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import { getDb, transaction, type DbClient, type DbTransaction } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import { getMollieClient, getMollieWebhookUrl, isMollieConfigured } from "@/lib/mollie/client";
import {
  deliverAlertEmail,
  openAlert,
  resolveAlertsForEntity,
} from "@/lib/reliability/alerts";
import { mapSubscriptionLifecycle } from "@/lib/subscriptions";

type SyncActor = {
  email?: string | null;
  kind: "system" | "user";
};

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
  mode: MollieMode;
  mollieSubscriptionId: string | null;
};

type LocalPaymentLink = {
  id: string;
};

type LocalMandateLink = {
  id: string;
};

type WebhookProcessingResult = {
  customerId: string | null;
  paymentId: string | null;
  subscriptionId: string | null;
};

function buildModesToTry(preferredMode?: MollieMode) {
  const orderedModes: MollieMode[] = preferredMode
    ? [preferredMode, preferredMode === "live" ? "test" : "live"]
    : ["live", "test"];

  return orderedModes.filter(
    (mode, index, array): mode is MollieMode =>
      array.indexOf(mode) === index && isMollieConfigured(mode),
  );
}

function resolvePaymentType(payment: Payment) {
  if (payment.subscriptionId || payment.sequenceType === "recurring") {
    return "recurring";
  }

  if (payment.sequenceType === "first") {
    return "first";
  }

  return "manual";
}

function hasChargeback(payment: Payment) {
  return Boolean(
    payment.amountChargedBack && payment.amountChargedBack.value !== "0.00",
  );
}

async function findPaymentAcrossModes(
  molliePaymentId: string,
  preferredMode?: MollieMode,
) {
  let lastError: unknown;

  for (const mode of buildModesToTry(preferredMode)) {
    try {
      const payment = await getMollieClient(mode).payments.get(molliePaymentId);
      return {
        mode,
        payment,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Payment was not found in Mollie.");
}

async function findSubscriptionAcrossModes(
  mollieSubscriptionId: string,
  customerMollieId: string,
  preferredMode?: MollieMode,
) {
  let lastError: unknown;

  for (const mode of buildModesToTry(preferredMode)) {
    try {
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
        mode,
        payments,
        subscription,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Subscription was not found in Mollie.");
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
        c.id as "customerId",
        c.mollie_customer_id as "customerMollieId"
      from subscriptions s
      inner join customers c on c.id = s.customer_id
      where s.mode = ${mode} and s.mollie_subscription_id = ${mollieSubscriptionId}
      limit 1
    `);

  return result.rows[0] ?? null;
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

async function handlePaymentAlerts(input: {
  customerId: string | null;
  localPaymentId: string;
  payment: Payment;
  subscriptionId: string | null;
}) {
  if (hasChargeback(input.payment)) {
    const alert = await openAlert({
      customerId: input.customerId,
      message:
        "A payment appears to have been charged back or disputed. Review the payment in Mollie and decide how the subscription should proceed.",
      paymentId: input.localPaymentId,
      severity: "critical",
      subscriptionId: input.subscriptionId,
      title: "Disputed payment",
    });

    if (alert.isNew) {
      await deliverAlertEmail({
        alertId: alert.id,
        message:
          "A payment was marked as charged back or disputed during synchronization. Open Mollie Manager and review the payment immediately.",
        title: "Disputed payment",
      });
    }

    return;
  }

  if (input.payment.status === "failed" || input.payment.status === "expired") {
    const alertTitle =
      input.payment.status === "failed" ? "Failed payment" : "Expired payment";
    const alert = await openAlert({
      customerId: input.customerId,
      message:
        input.payment.status === "failed"
          ? "A payment failed and needs review before service continues."
          : "A checkout expired before the payment completed.",
      paymentId: input.localPaymentId,
      severity: "warning",
      subscriptionId: input.subscriptionId,
      title: alertTitle,
    });

    if (alert.isNew) {
      await deliverAlertEmail({
        alertId: alert.id,
        message:
          input.payment.status === "failed"
            ? "A payment failed during synchronization. Open Mollie Manager to review the payment and the affected customer."
            : "A Mollie checkout expired before completion. Open Mollie Manager to decide whether to issue a new payment.",
        title: alertTitle,
      });
    }

    return;
  }

  await resolveAlertsForEntity({
    paymentId: input.localPaymentId,
  });
}

async function handleSubscriptionAlerts(input: {
  customerId: string;
  localSubscriptionId: string;
  localStatus: string;
}) {
  if (input.localStatus === "payment_action_required") {
    const alert = await openAlert({
      customerId: input.customerId,
      message:
        "The subscription is suspended or waiting for a payment-related intervention in Mollie.",
      severity: "warning",
      subscriptionId: input.localSubscriptionId,
      title: "Subscription needs payment action",
    });

    if (alert.isNew) {
      await deliverAlertEmail({
        alertId: alert.id,
        message:
          "A subscription entered a payment-action-required state. Open Mollie Manager to inspect the latest payment and subscription details.",
        title: "Subscription needs payment action",
      });
    }

    return;
  }

  if (input.localStatus === "out_of_sync") {
    const alert = await openAlert({
      customerId: input.customerId,
      message:
        "The local subscription state no longer matches the latest Mollie state.",
      severity: "critical",
      subscriptionId: input.localSubscriptionId,
      title: "Subscription out of sync",
    });

    if (alert.isNew) {
      await deliverAlertEmail({
        alertId: alert.id,
        message:
          "A subscription appears out of sync with Mollie. Open Mollie Manager and run a sync or reconciliation pass.",
        title: "Subscription out of sync",
      });
    }

    return;
  }

  await resolveAlertsForEntity({
    subscriptionId: input.localSubscriptionId,
  });
}

export async function syncPaymentByMollieId(
  molliePaymentId: string,
  options?: {
    actor?: SyncActor;
    preferredMode?: MollieMode;
  },
) {
  const actor = options?.actor ?? {
    kind: "system" as const,
  };
  const { mode, payment } = await findPaymentAcrossModes(
    molliePaymentId,
    options?.preferredMode,
  );
  const localCustomer = await getLocalCustomerByMollieId(mode, payment.customerId);
  const localSubscription = await getManagedSubscriptionByMollieId(
    mode,
    payment.subscriptionId,
  );
  const resolvedCustomerId = localCustomer?.id ?? localSubscription?.customerId ?? null;
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
    const existingPayment = await client.execute<LocalPaymentLink>(sql`
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
          ${resolvePaymentType(payment)},
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
          ${hasChargeback(payment) ? new Date().toISOString() : null}::timestamptz,
          ${JSON.stringify({
            description: payment.description,
            redirectUrl: payment.redirectUrl ?? null,
            statusReason: payment.statusReason ?? null,
            webhookUrl: getMollieWebhookUrl(),
          })}::jsonb,
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
          metadata = excluded.metadata,
          updated_at = now(),
          last_synced_at = now()
      `);

    await writeAuditLog(
      {
        action: "payment.sync",
        details: {
          localPaymentId,
          molliePaymentId: payment.id,
          mollieStatus: payment.status,
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

  return {
    customerId: resolvedCustomerId,
    paymentId: localPaymentId,
    subscriptionId: localSubscription?.id ?? null,
  } satisfies WebhookProcessingResult;
}

export async function syncSubscriptionByLocalId(
  localSubscriptionId: string,
  options?: {
    actor?: SyncActor;
  },
) {
  const actor = options?.actor ?? {
    kind: "system" as const,
  };
  const localSubscription = await getManagedSubscription(localSubscriptionId);

  if (!localSubscription?.mollieSubscriptionId || !localSubscription.customerMollieId) {
    throw new Error("Subscription is not linked to Mollie.");
  }

  const { subscription, payments } = await findSubscriptionAcrossModes(
    localSubscription.mollieSubscriptionId,
    localSubscription.customerMollieId,
    localSubscription.mode,
  );
  const resolvedSubscriptionId = localSubscription.id;

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
          billing_day = ${
            subscription.startDate
              ? new Date(`${subscription.startDate}T00:00:00Z`).getUTCDate()
              : null
          },
          start_date = ${subscription.startDate}::date,
          stop_after_current_period = ${subscription.status === "canceled" || subscription.status === "completed"},
          canceled_at = ${subscription.canceledAt ?? null}::timestamptz,
          metadata = ${JSON.stringify({
            nextPaymentDate: subscription.nextPaymentDate ?? null,
          })}::jsonb,
          updated_at = now(),
          last_synced_at = now()
        where id = ${localSubscription.id}
      `);

    for (const payment of payments) {
      const existingPayment = await client.execute<LocalPaymentLink>(sql`
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
            ${resolvePaymentType(payment)},
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
            ${hasChargeback(payment) ? new Date().toISOString() : null}::timestamptz,
            ${JSON.stringify({
              description: payment.description,
              redirectUrl: payment.redirectUrl ?? null,
            })}::jsonb,
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
            metadata = excluded.metadata,
            updated_at = now(),
            last_synced_at = now()
        `);
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
    const syncedPayment = await getDb().execute<LocalPaymentLink>(sql`
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

  await handleSubscriptionAlerts({
    customerId: localSubscription.customerId,
    localStatus: mapSubscriptionLifecycle(subscription.status),
    localSubscriptionId: resolvedSubscriptionId,
  });

  return {
    customerId: localSubscription.customerId,
    paymentId: null,
    subscriptionId: resolvedSubscriptionId,
  } satisfies WebhookProcessingResult;
}

export async function syncSubscriptionByMollieId(
  mollieSubscriptionId: string,
  options?: {
    actor?: SyncActor;
    preferredMode?: MollieMode;
  },
) {
  const localSubscription =
    (options?.preferredMode
      ? await getManagedSubscriptionByMollieId(
          options.preferredMode,
          mollieSubscriptionId,
        )
      : null) ??
    (await getManagedSubscriptionByMollieId("live", mollieSubscriptionId)) ??
    (await getManagedSubscriptionByMollieId("test", mollieSubscriptionId));

  if (!localSubscription) {
    throw new Error("Subscription was not found locally.");
  }

  return syncSubscriptionByLocalId(localSubscription.id, {
    actor: options?.actor,
  });
}

export async function reconcileOperationalData(actor?: SyncActor) {
  const effectiveActor = actor ?? {
    kind: "system" as const,
  };
  const subscriptions = await getDb().execute<{ id: string }>(sql`
      select id
      from subscriptions
      order by created_at desc
    `);
  const firstPayments = await getDb().execute<{ molliePaymentId: string }>(sql`
      select mollie_payment_id as "molliePaymentId"
      from payments
      where payment_type = 'first'
        and mollie_payment_id is not null
      order by created_at desc
    `);

  for (const subscription of subscriptions.rows) {
    await syncSubscriptionByLocalId(subscription.id, {
      actor: effectiveActor,
    });
  }

  for (const payment of firstPayments.rows) {
    await syncPaymentByMollieId(payment.molliePaymentId, {
      actor: effectiveActor,
    });
  }

  await writeAuditLog(
    {
      action: "reconciliation.run",
      details: {
        firstPaymentCount: firstPayments.rows.length,
        subscriptionCount: subscriptions.rows.length,
      },
      entityId: "system",
      entityType: "reconciliation",
      outcome: "success",
      summary: "Completed a full reconciliation pass against Mollie.",
    },
    undefined,
    effectiveActor,
  );

  return {
    firstPaymentsChecked: firstPayments.rows.length,
    subscriptionsChecked: subscriptions.rows.length,
  };
}
