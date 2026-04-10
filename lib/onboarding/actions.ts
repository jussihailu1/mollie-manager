"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { sql } from "drizzle-orm";
import {
  Locale,
  MandateStatus,
  PaymentMethod,
  SequenceType,
} from "@mollie/api-client";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit";
import { requireViewerSession } from "@/lib/auth/session";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { transaction, type DbTransaction } from "@/lib/db";
import { env } from "@/lib/env";
import { getMollieClient, getMollieWebhookUrl } from "@/lib/mollie/client";
import { getCustomerDetail, type MandateRecord } from "@/lib/onboarding/data";
import { syncPaymentLinkByMollieId } from "@/lib/reliability/sync";
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

const renewableFirstPaymentLinkStatuses = new Set([
  "archived",
  "canceled",
  "expired",
  "failed",
]);

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

async function getLocalPayments(customerId: string, client: DbTransaction) {
  const result = await client.execute<LocalPaymentRecord>(sql`
      select
        id,
        mollie_payment_id as "molliePaymentId",
        payment_type as "paymentType"
      from payments
      where customer_id = ${customerId} and mollie_payment_id is not null
      order by created_at desc
    `);

  return result.rows;
}

async function getLocalSubscriptions(customerId: string, client: DbTransaction) {
  const result = await client.execute<LocalSubscriptionRecord>(sql`
      select
        id,
        mollie_subscription_id as "mollieSubscriptionId"
      from subscriptions
      where customer_id = ${customerId} and mollie_subscription_id is not null
      order by created_at desc
    `);

  return result.rows;
}

async function upsertMandate(
  client: DbTransaction,
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
  const existing = await client.execute<{ id: string }>(sql`
      select id
      from mandates
      where mode = ${mode} and mollie_mandate_id = ${mandate.id}
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
        ${customerId},
        ${mode},
        ${mandate.id},
        ${mandate.method ?? null},
        ${mandate.status ?? null},
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
  return mandates.find(
    (mandate) =>
      (mandate.method === PaymentMethod.directdebit ||
        mandate.method === "directdebit") &&
      (mandate.mollieStatus === MandateStatus.valid ||
        mandate.mollieStatus === MandateStatus.pending),
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
    const selectedMode = await getSelectedMollieMode();
    const mollie = getMollieClient(selectedMode);
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
      await client.execute(sql`
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
            ${localCustomerId},
            ${createdCustomer.mode},
            ${createdCustomer.id},
            ${parsed.data.fullName},
            ${parsed.data.email},
            ${createdCustomer.locale ?? "nl_NL"},
            ${parsed.data.notes ?? null},
            ${JSON.stringify({
              mollieCreatedAt: createdCustomer.createdAt,
            })}::jsonb,
            now(),
            now(),
            now()
          )
        `);

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
    unstable_rethrow(error);
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
  const existingFirstPaymentLink = detail?.paymentLinks.find(
    (paymentLink) =>
      !renewableFirstPaymentLinkStatuses.has(paymentLink.mollieStatus ?? "open"),
  );

  if (existingFirstPayment) {
    redirectWithMessage(`/customers/${customer.id}`, {
      error:
        existingFirstPayment.mollieStatus === "paid"
          ? "A paid first payment already exists for this customer."
          : "A first payment already exists for this customer. Reuse or sync it before creating another one.",
    });
  }

  if (existingFirstPaymentLink) {
    redirectWithMessage(`/customers/${customer.id}`, {
      error:
        existingFirstPaymentLink.mollieStatus === "paid"
          ? "A paid first payment link already exists for this customer. Sync it before creating another one."
          : "A first payment link already exists for this customer. Reuse or sync it before creating another one.",
    });
  }

  try {
    const amountValue = normalizeAmountValue(parsed.data.amountValue);
    const mollie = getMollieClient(customer.mode);
    const localPaymentLinkId = crypto.randomUUID();
    const webhookUrl = getMollieWebhookUrl();
    const paymentLink = await mollie.paymentLinks.create({
      allowedMethods: [PaymentMethod.ideal],
      amount: {
        currency: "EUR",
        value: amountValue,
      },
      customerId: mollieCustomerId,
      description: parsed.data.description,
      idempotencyKey: crypto.randomUUID(),
      reusable: false,
      sequenceType: SequenceType.first,
      webhookUrl,
    });
    const paymentLinkStatus = paymentLink.archived
      ? "archived"
      : paymentLink.paidAt
        ? "paid"
        : "open";
    const paymentLinkAmount = paymentLink.amount ?? {
      currency: "EUR",
      value: amountValue,
    };

    await transaction(async (client) => {
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
            ${customer.id},
            ${paymentLink.mode},
            ${paymentLink.id},
            ${paymentLinkStatus},
            ${paymentLink.description},
            ${paymentLinkAmount.value},
            ${paymentLinkAmount.currency},
            ${paymentLink.getPaymentUrl()},
            ${paymentLink.expiresAt ?? null}::timestamptz,
            ${JSON.stringify({
              allowedMethods: paymentLink.allowedMethods ?? [PaymentMethod.ideal],
              latestPaymentId: null,
              latestPaymentStatus: null,
              mollieCustomerId,
              paymentType: "first",
              reusable: paymentLink.reusable ?? false,
              sequenceType: paymentLink.sequenceType ?? SequenceType.first,
              source: "subscription_onboarding",
              webhookUrl,
            })}::jsonb,
            coalesce(${paymentLink.createdAt ?? null}::timestamptz, now()),
            now(),
            now()
          )
        `);

      await writeAuditLog(
        {
          action: "payment_link.first.create",
          details: {
            localPaymentLinkId,
            molliePaymentLinkId: paymentLink.id,
          },
          entityId: localPaymentLinkId,
          entityType: "payment_link",
          mode: paymentLink.mode,
          outcome: "success",
          summary: "Created a durable first-payment link for mandate setup.",
        },
        client,
      );
    });

    revalidatePath(`/customers/${customer.id}`);
    revalidatePath("/customers");
    redirectWithMessage(`/customers/${customer.id}`, {
      notice: "First payment link created. Share the durable Mollie Payment Link URL with the customer.",
    });
  } catch (error) {
    unstable_rethrow(error);
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

  const session = await requireViewerSession();

  const customer = await getLocalCustomer(parsed.data.customerId);

  if (!customer || !customer.mollieCustomerId) {
    redirectWithMessage("/customers", {
      error: "Customer not found or not linked to Mollie.",
    });
  }
  const mollieCustomerId = customer.mollieCustomerId;
  const customerDetail = await getCustomerDetail(customer.id);

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

        await client.execute(sql`
            update payments
            set
              mandate_id = ${linkedMandateId},
              mollie_status = ${payment.status},
              sequence_type = ${payment.sequenceType},
              method = ${payment.method ?? null},
              checkout_url = ${payment.getCheckoutUrl()},
              expires_at = ${payment.expiresAt ?? null}::timestamptz,
              paid_at = ${payment.paidAt ?? null}::timestamptz,
              failed_at = ${payment.failedAt ?? null}::timestamptz,
              updated_at = now(),
              last_synced_at = now()
            where id = ${localPayment.id}
          `);
      }

      const localSubscriptions = await getLocalSubscriptions(customer.id, client);

      for (const localSubscription of localSubscriptions) {
        const subscription = await mollie.customerSubscriptions.get(
          localSubscription.mollieSubscriptionId,
          {
            customerId: mollieCustomerId,
          },
        );

        await client.execute(sql`
            update subscriptions
            set
              mollie_status = ${subscription.status},
              local_status = ${mapSubscriptionLifecycle(subscription.status)},
              updated_at = now(),
              last_synced_at = now()
            where id = ${localSubscription.id}
          `);
      }

      await writeAuditLog(
        {
          action: "customer.sync",
          details: {
            localCustomerId: customer.id,
            mandateCount: mandates.length,
            paymentLinkCount: customerDetail?.paymentLinks.length ?? 0,
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

    for (const paymentLink of customerDetail?.paymentLinks ?? []) {
      if (!paymentLink.molliePaymentLinkId) {
        continue;
      }

      await syncPaymentLinkByMollieId(paymentLink.molliePaymentLinkId, {
        actor: {
          email: session.user.email ?? null,
          kind: "user",
        },
        preferredMode: customer.mode,
      });
    }

    revalidatePath(`/customers/${customer.id}`);
    revalidatePath("/customers");
    revalidatePath("/subscriptions");
    redirectWithMessage(`/customers/${customer.id}`, {
      notice: "Customer state refreshed from Mollie.",
    });
  } catch (error) {
    unstable_rethrow(error);
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
      error:
        "No pending or valid direct debit mandate is available yet. Sync the customer first.",
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
      startDate,
      webhookUrl: getMollieWebhookUrl(),
    });

    await transaction(async (client) => {
      await client.execute(sql`
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
            ${localSubscriptionId},
            ${detail.customer.id},
            ${preferredMandate.id},
            ${subscription.mode},
            ${subscription.id},
            ${mapSubscriptionLifecycle(subscription.status)},
            ${subscription.status},
            ${subscription.description},
            ${subscription.interval},
            ${subscription.amount.value},
            ${subscription.amount.currency},
            ${
              latestPaidFirstPayment.paidAt
                ? new Date(latestPaidFirstPayment.paidAt).getUTCDate()
                : null
            },
            ${subscription.startDate}::date,
            ${false},
            ${JSON.stringify({
              nextPaymentDate: subscription.nextPaymentDate ?? null,
            })}::jsonb,
            now(),
            now(),
            now()
          )
        `);

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
    unstable_rethrow(error);
    redirectWithMessage(`/customers/${detail.customer.id}`, {
      error: serializeError(error),
    });
  }
}
