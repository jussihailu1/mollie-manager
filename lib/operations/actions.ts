"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit";
import { requireViewerSession } from "@/lib/auth/session";
import { query, transaction } from "@/lib/db";
import { getMollieClient } from "@/lib/mollie/client";
import type { MollieMode } from "@/lib/env";
import { mapSubscriptionLifecycle } from "@/lib/subscriptions";

type ManagedSubscription = {
  customerId: string;
  customerMollieId: string | null;
  id: string;
  localStatus: string;
  mode: MollieMode;
  mollieStatus: string | null;
  mollieSubscriptionId: string | null;
};

type LocalMandateLink = {
  id: string;
};

type LocalPaymentLink = {
  id: string;
};

const manageSubscriptionSchema = z.object({
  returnTo: z.string().trim().startsWith("/").default("/subscriptions"),
  subscriptionId: z.string().uuid(),
});

function buildPath(pathname: string, params?: URLSearchParams) {
  const search = params?.toString();
  return search ? `${pathname}?${search}` : pathname;
}

function redirectWithMessage(
  pathname: string,
  options: { error?: string; notice?: string },
): never {
  const params = new URLSearchParams();

  if (options.notice) {
    params.set("notice", options.notice);
  }

  if (options.error) {
    params.set("error", options.error);
  }

  redirect(buildPath(pathname, params));
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return error.message.slice(0, 180);
  }

  return "Something went wrong while talking to Mollie.";
}

function resolvePaymentType(sequenceType: string | null | undefined) {
  if (sequenceType === "first") {
    return "first";
  }

  if (sequenceType === "recurring") {
    return "recurring";
  }

  return "manual";
}

async function getManagedSubscription(subscriptionId: string) {
  const result = await query<ManagedSubscription>(
    `
      select
        s.id,
        s.mode,
        s.local_status as "localStatus",
        s.mollie_status as "mollieStatus",
        s.mollie_subscription_id as "mollieSubscriptionId",
        c.id as "customerId",
        c.mollie_customer_id as "customerMollieId"
      from subscriptions s
      inner join customers c on c.id = s.customer_id
      where s.id = $1
      limit 1
    `,
    [subscriptionId],
  );

  return result.rows[0] ?? null;
}

async function findLocalMandateId(
  mode: MollieMode,
  mollieMandateId: string | undefined,
) {
  if (!mollieMandateId) {
    return null;
  }

  const result = await query<LocalMandateLink>(
    `
      select id
      from mandates
      where mode = $1 and mollie_mandate_id = $2
      limit 1
    `,
    [mode, mollieMandateId],
  );

  return result.rows[0]?.id ?? null;
}

async function syncSubscriptionPayments(
  subscription: ManagedSubscription,
  options: { remoteMandateId?: string; remoteStatus?: string },
) {
  const mollieSubscriptionId = subscription.mollieSubscriptionId;
  const customerMollieId = subscription.customerMollieId;

  if (!mollieSubscriptionId || !customerMollieId) {
    throw new Error("Subscription is not linked to Mollie.");
  }

  const mollie = getMollieClient(subscription.mode);
  const [remoteSubscription, remotePayments] = await Promise.all([
    mollie.customerSubscriptions.get(mollieSubscriptionId, {
      customerId: customerMollieId,
    }),
    mollie.subscriptionPayments.page({
      customerId: customerMollieId,
      subscriptionId: mollieSubscriptionId,
    }),
  ]);

  const mandateId =
    (await findLocalMandateId(
      subscription.mode,
      options.remoteMandateId ?? remoteSubscription.mandateId,
    )) ?? null;

  await transaction(async (client) => {
    await client.query(
      `
        update subscriptions
        set
          mandate_id = $2,
          local_status = $3,
          mollie_status = $4,
          description = $5,
          interval = $6,
          amount_value = $7,
          amount_currency = $8,
          billing_day = $9,
          start_date = $10::date,
          stop_after_current_period = $11,
          canceled_at = $12::timestamptz,
          metadata = $13::jsonb,
          updated_at = now(),
          last_synced_at = now()
        where id = $1
      `,
      [
        subscription.id,
        mandateId,
        mapSubscriptionLifecycle(remoteSubscription.status),
        remoteSubscription.status,
        remoteSubscription.description,
        remoteSubscription.interval,
        remoteSubscription.amount.value,
        remoteSubscription.amount.currency,
        remoteSubscription.startDate
          ? new Date(`${remoteSubscription.startDate}T00:00:00Z`).getUTCDate()
          : null,
        remoteSubscription.startDate,
        remoteSubscription.status === "canceled" ||
        remoteSubscription.status === "completed",
        remoteSubscription.canceledAt ?? null,
        JSON.stringify({
          nextPaymentDate: remoteSubscription.nextPaymentDate ?? null,
        }),
      ],
    );

    for (const payment of remotePayments) {
      const existingPayment = await client.query<LocalPaymentLink>(
        `
          select id
          from payments
          where mode = $1 and mollie_payment_id = $2
          limit 1
        `,
        [subscription.mode, payment.id],
      );
      const localMandateId =
        (await findLocalMandateId(subscription.mode, payment.mandateId)) ??
        mandateId;

      await client.query(
        `
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
            metadata,
            created_at,
            updated_at,
            last_synced_at
          ) values (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
            $12,
            $13,
            $14::timestamptz,
            $15::timestamptz,
            $16::timestamptz,
            $17::jsonb,
            $18::timestamptz,
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
            metadata = excluded.metadata,
            updated_at = now(),
            last_synced_at = now()
        `,
        [
          existingPayment.rows[0]?.id ?? crypto.randomUUID(),
          subscription.customerId,
          subscription.id,
          localMandateId,
          subscription.mode,
          resolvePaymentType(payment.sequenceType),
          payment.id,
          payment.status,
          payment.sequenceType,
          payment.method ?? null,
          payment.amount.value,
          payment.amount.currency,
          payment.getCheckoutUrl(),
          payment.expiresAt ?? null,
          payment.paidAt ?? null,
          payment.failedAt ?? null,
          JSON.stringify({
            description: payment.description,
            mollieSubscriptionId,
            redirectUrl: payment.redirectUrl ?? null,
          }),
          payment.createdAt,
        ],
      );
    }

    await writeAuditLog(
      {
        action: "subscription.sync",
        details: {
          localSubscriptionId: subscription.id,
          mollieSubscriptionId,
          paymentCount: remotePayments.length,
        },
        entityId: subscription.id,
        entityType: "subscription",
        mode: subscription.mode,
        outcome: "success",
        summary: "Refreshed the subscription and its payments from Mollie.",
      },
      client,
    );
  });
}

export async function syncSubscriptionAction(formData: FormData) {
  const parsed = manageSubscriptionSchema.safeParse({
    returnTo: formData.get("returnTo"),
    subscriptionId: formData.get("subscriptionId"),
  });

  if (!parsed.success) {
    redirectWithMessage("/subscriptions", {
      error: "Subscription id is missing.",
    });
  }

  await requireViewerSession();

  const subscription = await getManagedSubscription(parsed.data.subscriptionId);

  if (!subscription) {
    redirectWithMessage("/subscriptions", {
      error: "Subscription not found.",
    });
  }

  try {
    await syncSubscriptionPayments(subscription, {});

    revalidatePath("/subscriptions");
    revalidatePath("/payments");
    revalidatePath(`/customers/${subscription.customerId}`);
    redirectWithMessage(parsed.data.returnTo, {
      notice: "Subscription and payment history refreshed from Mollie.",
    });
  } catch (error) {
    redirectWithMessage(parsed.data.returnTo, {
      error: serializeError(error),
    });
  }
}

export async function cancelSubscriptionAction(formData: FormData) {
  const parsed = manageSubscriptionSchema.safeParse({
    returnTo: formData.get("returnTo"),
    subscriptionId: formData.get("subscriptionId"),
  });

  if (!parsed.success) {
    redirectWithMessage("/subscriptions", {
      error: "Subscription id is missing.",
    });
  }

  await requireViewerSession();

  const subscription = await getManagedSubscription(parsed.data.subscriptionId);

  if (!subscription) {
    redirectWithMessage("/subscriptions", {
      error: "Subscription not found.",
    });
  }

  if (!subscription.mollieSubscriptionId || !subscription.customerMollieId) {
    redirectWithMessage(parsed.data.returnTo, {
      error: "Subscription is not linked to Mollie.",
    });
  }

  if (subscription.localStatus === "future_charges_stopped") {
    redirectWithMessage(parsed.data.returnTo, {
      notice: "Future charges were already stopped for this subscription.",
    });
  }

  try {
    const mollie = getMollieClient(subscription.mode);
    const canceledSubscription = await mollie.customerSubscriptions.cancel(
      subscription.mollieSubscriptionId,
      {
        customerId: subscription.customerMollieId,
        idempotencyKey: crypto.randomUUID(),
      },
    );

    await transaction(async (client) => {
      await client.query(
        `
          update subscriptions
          set
            local_status = 'future_charges_stopped',
            mollie_status = $2,
            stop_after_current_period = true,
            canceled_at = coalesce($3::timestamptz, now()),
            metadata = $4::jsonb,
            updated_at = now(),
            last_synced_at = now()
          where id = $1
        `,
        [
          subscription.id,
          canceledSubscription.status,
          canceledSubscription.canceledAt ?? null,
          JSON.stringify({
            nextPaymentDate: canceledSubscription.nextPaymentDate ?? null,
          }),
        ],
      );

      await writeAuditLog(
        {
          action: "subscription.cancel",
          details: {
            localSubscriptionId: subscription.id,
            mollieSubscriptionId: subscription.mollieSubscriptionId,
          },
          entityId: subscription.id,
          entityType: "subscription",
          mode: subscription.mode,
          outcome: "success",
          summary: "Stopped future charges for the subscription in Mollie.",
        },
        client,
      );
    });

    await syncSubscriptionPayments(subscription, {
      remoteMandateId: canceledSubscription.mandateId,
      remoteStatus: canceledSubscription.status,
    });

    revalidatePath("/subscriptions");
    revalidatePath("/payments");
    revalidatePath(`/customers/${subscription.customerId}`);
    redirectWithMessage(parsed.data.returnTo, {
      notice: "Future charges stopped. The subscription state was refreshed from Mollie.",
    });
  } catch (error) {
    redirectWithMessage(parsed.data.returnTo, {
      error: serializeError(error),
    });
  }
}
