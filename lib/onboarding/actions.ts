"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PoolClient } from "pg";
import {
  Locale,
  MandateStatus,
  PaymentMethod,
  SequenceType,
} from "@mollie/api-client";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit";
import { requireViewerSession } from "@/lib/auth/session";
import { transaction } from "@/lib/db";
import { env } from "@/lib/env";
import { getMollieClient, getMollieWebhookUrl } from "@/lib/mollie/client";
import { getCustomerDetail, type MandateRecord } from "@/lib/onboarding/data";
import { mapSubscriptionLifecycle } from "@/lib/subscriptions";

const createCustomerSchema = z.object({
  email: z.string().email(),
  fullName: z.string().trim().min(2).max(120),
  notes: z.string().trim().max(1000).optional(),
});

const createFirstPaymentSchema = z.object({
  amountValue: z.string().trim().min(1),
  customerId: z.string().uuid(),
  description: z.string().trim().min(2).max(140),
});

const syncCustomerSchema = z.object({
  customerId: z.string().uuid(),
});

const createSubscriptionSchema = z.object({
  amountValue: z.string().trim().min(1),
  customerId: z.string().uuid(),
  description: z.string().trim().min(2).max(140),
});

type LocalPaymentRecord = {
  id: string;
  molliePaymentId: string;
  paymentType: string;
};

type LocalSubscriptionRecord = {
  id: string;
  mollieSubscriptionId: string;
};

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

function normalizeAmountValue(value: string) {
  const normalized = value.replace(",", ".").trim();

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Enter a valid amount using up to two decimals.");
  }

  return Number(normalized).toFixed(2);
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return error.message.slice(0, 180);
  }

  return "Something went wrong while talking to Mollie.";
}

async function getLocalCustomer(customerId: string) {
  const detail = await getCustomerDetail(customerId);
  return detail?.customer ?? null;
}

async function getLocalPayments(customerId: string, client: PoolClient) {
  const result = await client.query<LocalPaymentRecord>(
    `
      select
        id,
        mollie_payment_id as "molliePaymentId",
        payment_type as "paymentType"
      from payments
      where customer_id = $1 and mollie_payment_id is not null
      order by created_at desc
    `,
    [customerId],
  );

  return result.rows;
}

async function getLocalSubscriptions(customerId: string, client: PoolClient) {
  const result = await client.query<LocalSubscriptionRecord>(
    `
      select
        id,
        mollie_subscription_id as "mollieSubscriptionId"
      from subscriptions
      where customer_id = $1 and mollie_subscription_id is not null
      order by created_at desc
    `,
    [customerId],
  );

  return result.rows;
}

async function upsertMandate(
  client: PoolClient,
  customerId: string,
  mode: "live" | "test",
  mandate: {
    createdAt?: string;
    details?: unknown;
    id: string;
    method?: string;
    status?: string;
  },
) {
  const existing = await client.query<{ id: string }>(
    `
      select id
      from mandates
      where mode = $1 and mollie_mandate_id = $2
      limit 1
    `,
    [mode, mandate.id],
  );

  const localMandateId = existing.rows[0]?.id ?? crypto.randomUUID();

  await client.query(
    `
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
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8::jsonb,
        coalesce($9::timestamptz, now()),
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
    `,
    [
      localMandateId,
      customerId,
      mode,
      mandate.id,
      mandate.method ?? null,
      mandate.status ?? null,
      mandate.status === MandateStatus.valid,
      JSON.stringify(
        typeof mandate.details === "object" && mandate.details !== null
          ? mandate.details
          : {},
      ),
      mandate.createdAt ?? null,
    ],
  );

  return localMandateId;
}

function toNextMonthlyStartDate(source: string) {
  const current = new Date(source);

  if (Number.isNaN(current.getTime())) {
    throw new Error("The first payment does not have a valid paid date.");
  }

  const year = current.getUTCFullYear();
  const month = current.getUTCMonth();
  const day = current.getUTCDate();
  const nextMonthStart = new Date(Date.UTC(year, month + 1, 1));
  const lastDayOfNextMonth = new Date(
    Date.UTC(nextMonthStart.getUTCFullYear(), nextMonthStart.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const targetDay = Math.min(day, lastDayOfNextMonth);
  const result = new Date(
    Date.UTC(nextMonthStart.getUTCFullYear(), nextMonthStart.getUTCMonth(), targetDay),
  );

  return result.toISOString().slice(0, 10);
}

function findPreferredMandate(mandates: MandateRecord[]) {
  return (
    mandates.find(
      (mandate) =>
        mandate.isValid &&
        (mandate.method === PaymentMethod.directdebit ||
          mandate.method === "directdebit"),
    ) ?? mandates.find((mandate) => mandate.isValid)
  );
}

export async function createCustomerAction(formData: FormData) {
  const parsed = createCustomerSchema.safeParse({
    email: formData.get("email"),
    fullName: formData.get("fullName"),
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    redirectWithMessage("/customers", {
      error: parsed.error.issues[0]?.message ?? "Enter a valid customer.",
    });
  }

  await requireViewerSession();

  try {
    const localCustomerId = crypto.randomUUID();
    const mollie = getMollieClient();
    const createdCustomer = await mollie.customers.create({
      email: parsed.data.email,
      idempotencyKey: crypto.randomUUID(),
      locale: Locale.nl_NL,
      metadata: {
        localCustomerId,
      },
      name: parsed.data.fullName,
    });

    await transaction(async (client) => {
      await client.query(
        `
          insert into customers (
            id,
            mode,
            mollie_customer_id,
            full_name,
            email,
            locale,
            notes,
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
            $8::jsonb,
            now(),
            now(),
            now()
          )
        `,
        [
          localCustomerId,
          createdCustomer.mode,
          createdCustomer.id,
          parsed.data.fullName,
          parsed.data.email,
          createdCustomer.locale ?? "nl_NL",
          parsed.data.notes ?? null,
          JSON.stringify({
            mollieCreatedAt: createdCustomer.createdAt,
          }),
        ],
      );

      await writeAuditLog(
        {
          action: "customer.create",
          details: {
            localCustomerId,
            mollieCustomerId: createdCustomer.id,
          },
          entityId: localCustomerId,
          entityType: "customer",
          mode: createdCustomer.mode,
          outcome: "success",
          summary: "Created customer in Mollie and stored it locally.",
        },
        client,
      );
    });

    revalidatePath("/customers");
    redirectWithMessage(`/customers/${localCustomerId}`, {
      notice: "Customer created. You can now generate the first payment link.",
    });
  } catch (error) {
    redirectWithMessage("/customers", {
      error: serializeError(error),
    });
  }
}

export async function createFirstPaymentAction(formData: FormData) {
  const parsed = createFirstPaymentSchema.safeParse({
    amountValue: formData.get("amountValue"),
    customerId: formData.get("customerId"),
    description: formData.get("description"),
  });

  if (!parsed.success) {
    redirectWithMessage("/customers", {
      error: parsed.error.issues[0]?.message ?? "Enter a valid first payment.",
    });
  }

  await requireViewerSession();

  const customer = await getLocalCustomer(parsed.data.customerId);

  if (!customer || !customer.mollieCustomerId) {
    redirectWithMessage("/customers", {
      error: "Customer not found or not linked to Mollie.",
    });
  }
  const mollieCustomerId = customer.mollieCustomerId;

  const detail = await getCustomerDetail(customer.id);
  const existingFirstPayment = detail?.payments.find(
    (payment) =>
      payment.paymentType === "first" &&
      payment.mollieStatus !== "failed" &&
      payment.mollieStatus !== "expired" &&
      payment.mollieStatus !== "canceled",
  );

  if (existingFirstPayment) {
    redirectWithMessage(`/customers/${customer.id}`, {
      error:
        existingFirstPayment.mollieStatus === "paid"
          ? "A paid first payment already exists for this customer."
          : "A first payment already exists for this customer. Reuse or sync it before creating another one.",
    });
  }

  try {
    const amountValue = normalizeAmountValue(parsed.data.amountValue);
    const mollie = getMollieClient(customer.mode);
    const localPaymentId = crypto.randomUUID();
    const payment = await mollie.customerPayments.create({
      amount: {
        currency: "EUR",
        value: amountValue,
      },
      customerId: mollieCustomerId,
      description: parsed.data.description,
      idempotencyKey: crypto.randomUUID(),
      metadata: {
        customerId: customer.id,
        localPaymentId,
        paymentType: "first",
      },
      method: PaymentMethod.ideal,
      redirectUrl: `${env.APP_URL}/customers/${customer.id}?notice=Returned+from+Mollie.+Use+sync+to+refresh+payment+status.`,
      sequenceType: SequenceType.first,
      webhookUrl: getMollieWebhookUrl(),
    });

    await transaction(async (client) => {
      await client.query(
        `
          insert into payments (
            id,
            customer_id,
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
            'first',
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11::timestamptz,
            $12::timestamptz,
            $13::timestamptz,
            $14::jsonb,
            now(),
            now(),
            now()
          )
        `,
        [
          localPaymentId,
          customer.id,
          payment.mode,
          payment.id,
          payment.status,
          payment.sequenceType,
          payment.method ?? null,
          amountValue,
          payment.amount.currency,
          payment.getCheckoutUrl(),
          payment.expiresAt ?? null,
          payment.paidAt ?? null,
          payment.failedAt ?? null,
          JSON.stringify({
            description: payment.description,
            redirectUrl: payment.redirectUrl ?? null,
          }),
        ],
      );

      await writeAuditLog(
        {
          action: "payment.first.create",
          details: {
            localPaymentId,
            molliePaymentId: payment.id,
          },
          entityId: localPaymentId,
          entityType: "payment",
          mode: payment.mode,
          outcome: "success",
          summary: "Created the first iDEAL payment for mandate setup.",
        },
        client,
      );
    });

    revalidatePath(`/customers/${customer.id}`);
    revalidatePath("/customers");
    redirectWithMessage(`/customers/${customer.id}`, {
      notice: "First payment created. Share the Mollie checkout URL with the customer.",
    });
  } catch (error) {
    redirectWithMessage(`/customers/${customer.id}`, {
      error: serializeError(error),
    });
  }
}

export async function syncCustomerBillingStateAction(formData: FormData) {
  const parsed = syncCustomerSchema.safeParse({
    customerId: formData.get("customerId"),
  });

  if (!parsed.success) {
    redirectWithMessage("/customers", {
      error: "Customer id is missing.",
    });
  }

  await requireViewerSession();

  const customer = await getLocalCustomer(parsed.data.customerId);

  if (!customer || !customer.mollieCustomerId) {
    redirectWithMessage("/customers", {
      error: "Customer not found or not linked to Mollie.",
    });
  }
  const mollieCustomerId = customer.mollieCustomerId;

  try {
    const mollie = getMollieClient(customer.mode);
    const mandates = await mollie.customerMandates.page({
      customerId: mollieCustomerId,
    });

    await transaction(async (client) => {
      const mandateIdMap = new Map<string, string>();

      for (const mandate of mandates) {
        const localMandateId = await upsertMandate(client, customer.id, customer.mode, {
          createdAt: mandate.createdAt,
          details: mandate.details,
          id: mandate.id,
          method: mandate.method,
          status: mandate.status,
        });

        mandateIdMap.set(mandate.id, localMandateId);
      }

      const localPayments = await getLocalPayments(customer.id, client);

      for (const localPayment of localPayments) {
        const payment = await mollie.payments.get(localPayment.molliePaymentId);
        const linkedMandateId = payment.mandateId
          ? mandateIdMap.get(payment.mandateId) ?? null
          : null;

        await client.query(
          `
            update payments
            set
              mandate_id = $2,
              mollie_status = $3,
              sequence_type = $4,
              method = $5,
              checkout_url = $6,
              expires_at = $7::timestamptz,
              paid_at = $8::timestamptz,
              failed_at = $9::timestamptz,
              updated_at = now(),
              last_synced_at = now()
            where id = $1
          `,
          [
            localPayment.id,
            linkedMandateId,
            payment.status,
            payment.sequenceType,
            payment.method ?? null,
            payment.getCheckoutUrl(),
            payment.expiresAt ?? null,
            payment.paidAt ?? null,
            payment.failedAt ?? null,
          ],
        );
      }

      const localSubscriptions = await getLocalSubscriptions(customer.id, client);

      for (const localSubscription of localSubscriptions) {
        const subscription = await mollie.customerSubscriptions.get(
          localSubscription.mollieSubscriptionId,
          {
            customerId: mollieCustomerId,
          },
        );

        await client.query(
          `
            update subscriptions
            set
              mollie_status = $2,
              local_status = $3,
              updated_at = now(),
              last_synced_at = now()
            where id = $1
          `,
          [
            localSubscription.id,
            subscription.status,
            mapSubscriptionLifecycle(subscription.status),
          ],
        );
      }

      await writeAuditLog(
        {
          action: "customer.sync",
          details: {
            localCustomerId: customer.id,
            mandateCount: mandates.length,
          },
          entityId: customer.id,
          entityType: "customer",
          mode: customer.mode,
          outcome: "success",
          summary: "Refreshed mandates, payments, and subscriptions from Mollie.",
        },
        client,
      );
    });

    revalidatePath(`/customers/${customer.id}`);
    revalidatePath("/customers");
    revalidatePath("/subscriptions");
    redirectWithMessage(`/customers/${customer.id}`, {
      notice: "Customer state refreshed from Mollie.",
    });
  } catch (error) {
    redirectWithMessage(`/customers/${customer.id}`, {
      error: serializeError(error),
    });
  }
}

export async function createSubscriptionAction(formData: FormData) {
  const parsed = createSubscriptionSchema.safeParse({
    amountValue: formData.get("amountValue"),
    customerId: formData.get("customerId"),
    description: formData.get("description"),
  });

  if (!parsed.success) {
    redirectWithMessage("/subscriptions", {
      error: parsed.error.issues[0]?.message ?? "Enter a valid subscription.",
    });
  }

  await requireViewerSession();

  const detail = await getCustomerDetail(parsed.data.customerId);

  if (!detail || !detail.customer.mollieCustomerId) {
    redirectWithMessage("/customers", {
      error: "Customer not found or not linked to Mollie.",
    });
  }
  const mollieCustomerId = detail.customer.mollieCustomerId;

  const latestPaidFirstPayment = detail.payments.find(
    (payment) => payment.paymentType === "first" && payment.mollieStatus === "paid" && payment.paidAt,
  );
  const preferredMandate = findPreferredMandate(detail.mandates);
  const existingSubscription = detail.subscriptions.find(
    (subscription) =>
      subscription.localStatus === "active" ||
      subscription.localStatus === "mandate_pending" ||
      subscription.localStatus === "draft",
  );

  if (!latestPaidFirstPayment) {
    redirectWithMessage(`/customers/${detail.customer.id}`, {
      error: "A successful first payment is required before creating the subscription.",
    });
  }

  if (!preferredMandate) {
    redirectWithMessage(`/customers/${detail.customer.id}`, {
      error: "No valid direct debit mandate is available yet. Sync the customer first.",
    });
  }

  if (existingSubscription) {
    redirectWithMessage(`/customers/${detail.customer.id}`, {
      error:
        "This customer already has a local subscription record in progress or active. Review it before creating another one.",
    });
  }

  try {
    const amountValue = normalizeAmountValue(parsed.data.amountValue);
    const startDate = toNextMonthlyStartDate(latestPaidFirstPayment.paidAt!);
    const mollie = getMollieClient(detail.customer.mode);
    const localSubscriptionId = crypto.randomUUID();
    const subscription = await mollie.customerSubscriptions.create({
      amount: {
        currency: "EUR",
        value: amountValue,
      },
      customerId: mollieCustomerId,
      description: parsed.data.description,
      idempotencyKey: crypto.randomUUID(),
      interval: "1 month",
      mandateId: preferredMandate.mollieMandateId,
      metadata: {
        customerId: detail.customer.id,
        localSubscriptionId,
      },
      method: PaymentMethod.directdebit,
      startDate,
      webhookUrl: getMollieWebhookUrl(),
    });

    await transaction(async (client) => {
      await client.query(
        `
          insert into subscriptions (
            id,
            customer_id,
            mandate_id,
            mode,
            mollie_subscription_id,
            local_status,
            mollie_status,
            description,
            interval,
            amount_value,
            amount_currency,
            billing_day,
            start_date,
            stop_after_current_period,
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
            $13::date,
            $14,
            $15::jsonb,
            now(),
            now(),
            now()
          )
        `,
        [
          localSubscriptionId,
          detail.customer.id,
          preferredMandate.id,
          subscription.mode,
          subscription.id,
          mapSubscriptionLifecycle(subscription.status),
          subscription.status,
          subscription.description,
          subscription.interval,
          subscription.amount.value,
          subscription.amount.currency,
          latestPaidFirstPayment.paidAt
            ? new Date(latestPaidFirstPayment.paidAt).getUTCDate()
            : null,
          subscription.startDate,
          false,
          JSON.stringify({
            nextPaymentDate: subscription.nextPaymentDate ?? null,
          }),
        ],
      );

      await writeAuditLog(
        {
          action: "subscription.create",
          details: {
            localSubscriptionId,
            mollieSubscriptionId: subscription.id,
            startDate: subscription.startDate,
          },
          entityId: localSubscriptionId,
          entityType: "subscription",
          mode: subscription.mode,
          outcome: "success",
          summary: "Created a monthly subscription from a verified first payment.",
        },
        client,
      );
    });

    revalidatePath(`/customers/${detail.customer.id}`);
    revalidatePath("/customers");
    revalidatePath("/subscriptions");
    redirectWithMessage(`/customers/${detail.customer.id}`, {
      notice: "Subscription created. Future charges are now scheduled in Mollie.",
    });
  } catch (error) {
    redirectWithMessage(`/customers/${detail.customer.id}`, {
      error: serializeError(error),
    });
  }
}
