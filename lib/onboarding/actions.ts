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
import {
  getEboekhoudenRelation,
  toPublicEboekhoudenError,
  updateEboekhoudenRelation,
} from "@/lib/eboekhouden/client";
import {
  localFieldsToRelationPatch,
  relationToLocalFields,
  type EboekhoudenRelation,
  type LocalRelationFields,
} from "@/lib/eboekhouden/relation-mapping";
import { getMollieClient, getMollieWebhookUrl } from "@/lib/mollie/client";
import { getCustomerDetail, type MandateRecord } from "@/lib/onboarding/data";
import { syncPaymentLinkByMollieId } from "@/lib/reliability/sync";
import { mapSubscriptionLifecycle } from "@/lib/subscriptions";

const createCustomerSchema = z.object({
  address: z.string().trim().max(240).optional(),
  businessName: z.string().trim().min(2).max(120),
  contactName: z.string().trim().min(2).max(120),
  email: z.string().email(),
  eboekhoudenRelationId: z.coerce.number().int().positive().optional(),
  notes: z.string().trim().max(1000).optional(),
  phone: z.string().trim().max(80).optional(),
  returnTo: z.string().trim().startsWith("/").default("/customers"),
  source: z.enum(["local", "eboekhouden"]).default("local"),
});

const linkEboekhoudenRelationSchema = z.object({
  address: z.string().trim().max(240).optional(),
  businessName: z.string().trim().min(2).max(120),
  contactName: z.string().trim().min(2).max(120),
  customerId: z.string().uuid(),
  email: z.string().email(),
  eboekhoudenRelationId: z.coerce.number().int().positive(),
  notes: z.string().trim().max(1000).optional(),
  phone: z.string().trim().max(80).optional(),
  returnTo: z.string().trim().startsWith("/").default("/customers"),
});

const createFirstPaymentSchema = z.object({
  amountValue: z.string().trim().min(1),
  customerId: z.string().uuid(),
  description: z.string().trim().min(2).max(140),
  returnTo: z.string().trim().startsWith("/").default("/customers"),
});

const syncCustomerSchema = z.object({
  customerId: z.string().uuid(),
  returnTo: z.string().trim().startsWith("/").default("/customers"),
});

const customerArchiveSchema = z.object({
  customerId: z.string().uuid(),
  returnTo: z.string().trim().startsWith("/").default("/customers"),
});

const createSubscriptionSchema = z.object({
  amountValue: z.string().trim().min(1),
  customerId: z.string().uuid(),
  description: z.string().trim().min(2).max(140),
  interval: z.enum(["weekly", "monthly", "yearly"]).default("monthly"),
  returnTo: z.string().trim().startsWith("/").default("/customers"),
  startDate: z.string().trim().optional(),
});

const renewableFirstPaymentLinkStatuses = new Set([
  "archived",
  "canceled",
  "expired",
  "failed",
]);

const archiveBlockedSubscriptionStatuses = new Set([
  "active",
  "awaiting_first_payment",
  "draft",
  "mandate_pending",
  "payment_action_required",
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

function updatePath(
  pathname: string,
  updates: Record<string, string | null | undefined>,
) {
  const [basePath, existingSearch] = pathname.split("?", 2);
  const params = new URLSearchParams(existingSearch ?? "");

  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined || value.length === 0) {
      params.delete(key);
      continue;
    }

    params.set(key, value);
  }

  return buildPath(basePath, params);
}

function redirectWithMessage(
  pathname: string,
  options: { error?: string; notice?: string },
): never {
  redirect(
    updatePath(pathname, {
      error: options.error,
      notice: options.notice,
    }),
  );
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

function serializeIntegrationError(error: unknown) {
  const eboekhoudenError = toPublicEboekhoudenError(error);

  if (eboekhoudenError.code !== "unknown_error") {
    return eboekhoudenError.message.slice(0, 180);
  }

  return serializeError(error);
}

function toRelationFields(data: {
  address?: string;
  businessName: string;
  contactName: string;
  email: string;
  notes?: string;
  phone?: string;
}): LocalRelationFields {
  return {
    address: data.address ?? "",
    businessName: data.businessName,
    contactName: data.contactName,
    email: data.email,
    notes: data.notes ?? "",
    phone: data.phone ?? "",
  };
}

function shouldPatchRelation(
  relation: EboekhoudenRelation,
  fields: LocalRelationFields,
) {
  const existingFields = relationToLocalFields(relation);

  return Object.entries(fields).some(([field, value]) => {
    const currentValue = existingFields[field as keyof LocalRelationFields];
    return value.trim().length > 0 && currentValue.trim() !== value.trim();
  });
}

async function updateRelationFromLocalFields(
  relationId: number,
  fields: LocalRelationFields,
) {
  const relation = await getEboekhoudenRelation(relationId);

  if (!shouldPatchRelation(relation, fields)) {
    return relation;
  }

  await updateEboekhoudenRelation(
    relationId,
    localFieldsToRelationPatch(fields, relation),
  );

  return getEboekhoudenRelation(relationId);
}

async function getLocalCustomer(customerId: string, mode: "live" | "test") {
  const detail = await getCustomerDetail(customerId, mode);
  return detail?.customer ?? null;
}

async function assertRelationIsAvailable(
  relationId: number,
  mode: "live" | "test",
  excludeCustomerId?: string,
) {
  const existing = await transaction(async (client) => {
    const result = excludeCustomerId
      ? await client.execute<{ id: string }>(sql`
          select id
          from customers
          where mode = ${mode}
            and eboekhouden_relation_id = ${relationId}
            and id <> ${excludeCustomerId}
          limit 1
        `)
      : await client.execute<{ id: string }>(sql`
        select id
        from customers
        where mode = ${mode}
          and eboekhouden_relation_id = ${relationId}
        limit 1
      `);

    return result.rows[0] ?? null;
  });

  if (existing) {
    throw new Error("This e-Boekhouden relation is already linked to another customer.");
  }
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

export async function archiveCustomerAction(formData: FormData) {
  const parsed = customerArchiveSchema.safeParse({
    customerId: formData.get("customerId"),
    returnTo: formData.get("returnTo") || undefined,
  });

  if (!parsed.success) {
    redirectWithMessage("/customers", {
      error: "Customer id is missing.",
    });
  }

  const session = await requireViewerSession();
  const selectedMode = await getSelectedMollieMode();
  const detail = await getCustomerDetail(parsed.data.customerId, selectedMode);
  const returnTo = updatePath(parsed.data.returnTo, {
    focus: null,
  });

  if (!detail) {
    redirectWithMessage(returnTo, {
      error: "Customer not found in the selected Mollie mode.",
    });
  }

  if (detail.customer.archivedAt) {
    redirectWithMessage(returnTo, {
      notice: "Customer is already archived.",
    });
  }

  const blockingSubscription = detail.subscriptions.find((subscription) =>
    archiveBlockedSubscriptionStatuses.has(subscription.localStatus),
  );

  if (blockingSubscription) {
    redirectWithMessage(returnTo, {
      error: "Cancel or stop active billing before archiving this customer.",
    });
  }

  await transaction(async (client) => {
    await client.execute(sql`
        update customers
        set archived_at = now(), updated_at = now()
        where id = ${detail.customer.id}
          and mode = ${selectedMode}
          and archived_at is null
      `);

    await writeAuditLog(
      {
        action: "customer.archive",
        details: {
          localCustomerId: detail.customer.id,
          mollieCustomerId: detail.customer.mollieCustomerId,
        },
        entityId: detail.customer.id,
        entityType: "customer",
        mode: selectedMode,
        outcome: "success",
        summary: "Archived local customer record.",
      },
      client,
      {
        email: session.user.email ?? null,
        kind: "user",
      },
    );
  });

  revalidatePath("/");
  revalidatePath("/customers");
  revalidatePath("/payments");
  revalidatePath("/notifications");
  redirectWithMessage(returnTo, {
    notice: "Customer archived.",
  });
}

export async function restoreCustomerAction(formData: FormData) {
  const parsed = customerArchiveSchema.safeParse({
    customerId: formData.get("customerId"),
    returnTo: formData.get("returnTo") || undefined,
  });

  if (!parsed.success) {
    redirectWithMessage("/customers", {
      error: "Customer id is missing.",
    });
  }

  const session = await requireViewerSession();
  const selectedMode = await getSelectedMollieMode();
  const detail = await getCustomerDetail(parsed.data.customerId, selectedMode);
  const returnTo = updatePath(parsed.data.returnTo, {
    focus: parsed.data.customerId,
    view: null,
  });

  if (!detail) {
    redirectWithMessage(returnTo, {
      error: "Customer not found in the selected Mollie mode.",
    });
  }

  if (!detail.customer.archivedAt) {
    redirectWithMessage(returnTo, {
      notice: "Customer is already active.",
    });
  }

  await transaction(async (client) => {
    await client.execute(sql`
        update customers
        set archived_at = null, updated_at = now()
        where id = ${detail.customer.id}
          and mode = ${selectedMode}
          and archived_at is not null
      `);

    await writeAuditLog(
      {
        action: "customer.restore",
        details: {
          localCustomerId: detail.customer.id,
          mollieCustomerId: detail.customer.mollieCustomerId,
        },
        entityId: detail.customer.id,
        entityType: "customer",
        mode: selectedMode,
        outcome: "success",
        summary: "Restored archived local customer record.",
      },
      client,
      {
        email: session.user.email ?? null,
        kind: "user",
      },
    );
  });

  revalidatePath("/");
  revalidatePath("/customers");
  revalidatePath("/payments");
  revalidatePath("/notifications");
  redirectWithMessage(returnTo, {
    notice: "Customer restored.",
  });
}

export async function createCustomerAction(formData: FormData) {
  const parsed = createCustomerSchema.safeParse({
    address: formData.get("address") || undefined,
    businessName: formData.get("businessName"),
    contactName: formData.get("contactName"),
    email: formData.get("email"),
    eboekhoudenRelationId: formData.get("eboekhoudenRelationId") || undefined,
    notes: formData.get("notes") || undefined,
    phone: formData.get("phone") || undefined,
    returnTo: formData.get("returnTo") || undefined,
    source: formData.get("source") || "local",
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
    const relationFields = toRelationFields(parsed.data);
    const relationIdToLink =
      parsed.data.source === "eboekhouden"
        ? parsed.data.eboekhoudenRelationId
        : undefined;

    if (relationIdToLink) {
      await assertRelationIsAvailable(relationIdToLink, selectedMode);
    }

    const linkedRelation =
      relationIdToLink
        ? await updateRelationFromLocalFields(relationIdToLink, relationFields)
        : null;

    const mollie = getMollieClient(selectedMode);
    const createdCustomer = await mollie.customers.create({
      email: parsed.data.email,
      idempotencyKey: crypto.randomUUID(),
      locale: Locale.nl_NL,
      metadata: {
        address: parsed.data.address ?? null,
        businessName: parsed.data.businessName,
        contactName: parsed.data.contactName,
        localCustomerId,
        phone: parsed.data.phone ?? null,
      },
      name: parsed.data.businessName,
    });

    await transaction(async (client) => {
      await client.execute(sql`
          insert into customers (
            id,
            mode,
            mollie_customer_id,
            eboekhouden_relation_id,
            eboekhouden_relation_code,
            eboekhouden_link_status,
            eboekhouden_synced_at,
            eboekhouden_relation_snapshot,
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
            ${selectedMode},
            ${createdCustomer.id},
            ${linkedRelation?.id ?? null},
            ${linkedRelation?.code ?? null},
            ${linkedRelation ? "linked" : "unlinked"}::eboekhouden_link_status,
            ${linkedRelation ? sql`now()` : null},
            ${JSON.stringify(linkedRelation ?? {})}::jsonb,
            ${parsed.data.businessName},
            ${parsed.data.email},
            ${createdCustomer.locale ?? "nl_NL"},
            ${parsed.data.notes ?? null},
            ${JSON.stringify({
              address: parsed.data.address ?? null,
              businessName: parsed.data.businessName,
              contactName: parsed.data.contactName,
              mollieCreatedAt: createdCustomer.createdAt,
              phone: parsed.data.phone ?? null,
            })}::jsonb,
            now(),
            now(),
            now()
          )
        `);

      await writeAuditLog(
        {
          action: linkedRelation ? "customer.create_from_eboekhouden" : "customer.create",
          details: {
            eboekhoudenRelationId: linkedRelation?.id ?? null,
            localCustomerId,
            mollieCustomerId: createdCustomer.id,
          },
          entityId: localCustomerId,
          entityType: "customer",
          mode: selectedMode,
          outcome: "success",
          summary: linkedRelation
            ? "Imported an e-Boekhouden relation, created a Mollie customer, and stored the local bridge."
            : "Created customer in Mollie and stored it locally.",
        },
        client,
      );
    });

    const returnTo = updatePath(parsed.data.returnTo, {
      focus: localCustomerId,
    });

    revalidatePath("/");
    revalidatePath("/customers");
    revalidatePath("/payments");
    redirectWithMessage(returnTo, {
      notice: linkedRelation
        ? "Customer imported from e-Boekhouden. You can now generate the first payment link."
        : "Customer created as unlinked from e-Boekhouden. You can now generate the first payment link.",
    });
  } catch (error) {
    unstable_rethrow(error);
    redirectWithMessage("/customers", {
      error: serializeIntegrationError(error),
    });
  }
}

export async function linkEboekhoudenRelationAction(formData: FormData) {
  const parsed = linkEboekhoudenRelationSchema.safeParse({
    address: formData.get("address") || undefined,
    businessName: formData.get("businessName"),
    contactName: formData.get("contactName"),
    customerId: formData.get("customerId"),
    email: formData.get("email"),
    eboekhoudenRelationId: formData.get("eboekhoudenRelationId"),
    notes: formData.get("notes") || undefined,
    phone: formData.get("phone") || undefined,
    returnTo: formData.get("returnTo") || undefined,
  });

  if (!parsed.success) {
    redirectWithMessage("/customers", {
      error: parsed.error.issues[0]?.message ?? "Enter valid customer details.",
    });
  }

  const session = await requireViewerSession();
  const selectedMode = await getSelectedMollieMode();
  const returnTo = updatePath(parsed.data.returnTo, {
    focus: parsed.data.customerId,
  });
  const customer = await getLocalCustomer(parsed.data.customerId, selectedMode);

  if (!customer) {
    redirectWithMessage(returnTo, {
      error: "Customer not found in the selected Mollie mode.",
    });
  }

  if (customer.archivedAt) {
    redirectWithMessage(returnTo, {
      error: "Restore this customer before changing e-Boekhouden links.",
    });
  }

  try {
    await assertRelationIsAvailable(
      parsed.data.eboekhoudenRelationId,
      selectedMode,
      customer.id,
    );

    const relationFields = toRelationFields(parsed.data);
    const linkedRelation = await updateRelationFromLocalFields(
      parsed.data.eboekhoudenRelationId,
      relationFields,
    );

    await transaction(async (client) => {
      await client.execute(sql`
          update customers
          set
            eboekhouden_relation_id = ${linkedRelation.id},
            eboekhouden_relation_code = ${linkedRelation.code ?? null},
            eboekhouden_link_status = 'linked',
            eboekhouden_synced_at = now(),
            eboekhouden_relation_snapshot = ${JSON.stringify(linkedRelation)}::jsonb,
            full_name = ${parsed.data.businessName},
            email = ${parsed.data.email},
            notes = ${parsed.data.notes ?? null},
            metadata = metadata || ${JSON.stringify({
              address: parsed.data.address ?? null,
              businessName: parsed.data.businessName,
              contactName: parsed.data.contactName,
              phone: parsed.data.phone ?? null,
            })}::jsonb,
            updated_at = now(),
            last_synced_at = now()
          where id = ${customer.id}
            and mode = ${selectedMode}
        `);

      await writeAuditLog(
        {
          action: "customer.eboekhouden.link",
          details: {
            eboekhoudenRelationId: linkedRelation.id,
            localCustomerId: customer.id,
          },
          entityId: customer.id,
          entityType: "customer",
          mode: selectedMode,
          outcome: "success",
          summary: "Linked local customer to an e-Boekhouden relation.",
        },
        client,
        {
          email: session.user.email ?? null,
          kind: "user",
        },
      );
    });

    revalidatePath("/");
    revalidatePath("/customers");
    revalidatePath("/payments");
    redirectWithMessage(returnTo, {
      notice: "Customer linked to e-Boekhouden.",
    });
  } catch (error) {
    unstable_rethrow(error);
    redirectWithMessage(returnTo, {
      error: serializeIntegrationError(error),
    });
  }
}

export async function createFirstPaymentAction(formData: FormData) {
  const parsed = createFirstPaymentSchema.safeParse({
    amountValue: formData.get("amountValue"),
    customerId: formData.get("customerId"),
    description: formData.get("description"),
    returnTo: formData.get("returnTo") || undefined,
  });

  if (!parsed.success) {
    redirectWithMessage("/customers", {
      error: parsed.error.issues[0]?.message ?? "Enter a valid first payment.",
    });
  }

  await requireViewerSession();

  const selectedMode = await getSelectedMollieMode();
  const customer = await getLocalCustomer(parsed.data.customerId, selectedMode);
  const returnTo = updatePath(parsed.data.returnTo, {
    focus: parsed.data.customerId,
  });

  if (!customer || !customer.mollieCustomerId) {
    redirectWithMessage("/customers", {
      error: "Customer not found in the selected Mollie mode or not linked to Mollie.",
    });
  }

  if (customer.archivedAt) {
    redirectWithMessage(returnTo, {
      error: "Restore this customer before creating a payment link.",
    });
  }

  const mollieCustomerId = customer.mollieCustomerId;

  const detail = await getCustomerDetail(customer.id, selectedMode);
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
    redirectWithMessage(returnTo, {
      error:
        existingFirstPayment.mollieStatus === "paid"
          ? "A paid first payment already exists for this customer."
          : "A first payment already exists for this customer. Reuse or sync it before creating another one.",
    });
  }

  if (existingFirstPaymentLink) {
    redirectWithMessage(returnTo, {
      error:
        existingFirstPaymentLink.mollieStatus === "paid"
          ? "A paid first payment link already exists for this customer. Sync it before creating another one."
          : "A first payment link already exists for this customer. Reuse or sync it before creating another one.",
    });
  }

  try {
    const amountValue = normalizeAmountValue(parsed.data.amountValue);
    const mollie = getMollieClient(selectedMode);
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
            ${selectedMode},
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
          mode: selectedMode,
          outcome: "success",
          summary: "Created a durable first-payment link for mandate setup.",
        },
        client,
      );
    });

    revalidatePath("/");
    revalidatePath("/customers");
    revalidatePath("/payments");
    redirectWithMessage(returnTo, {
      notice:
        "First payment link created. Share the durable Mollie Payment Link URL with the customer.",
    });
  } catch (error) {
    unstable_rethrow(error);
    redirectWithMessage(returnTo, {
      error: serializeError(error),
    });
  }
}

export async function syncCustomerBillingStateAction(formData: FormData) {
  const parsed = syncCustomerSchema.safeParse({
    customerId: formData.get("customerId"),
    returnTo: formData.get("returnTo") || undefined,
  });

  if (!parsed.success) {
    redirectWithMessage("/customers", {
      error: "Customer id is missing.",
    });
  }

  const session = await requireViewerSession();

  const selectedMode = await getSelectedMollieMode();
  const customer = await getLocalCustomer(parsed.data.customerId, selectedMode);
  const returnTo = updatePath(parsed.data.returnTo, {
    focus: parsed.data.customerId,
  });

  if (!customer || !customer.mollieCustomerId) {
    redirectWithMessage("/customers", {
      error: "Customer not found in the selected Mollie mode or not linked to Mollie.",
    });
  }

  if (customer.archivedAt) {
    redirectWithMessage(returnTo, {
      error: "Restore this customer before refreshing billing state.",
    });
  }

  const mollieCustomerId = customer.mollieCustomerId;
  const customerDetail = await getCustomerDetail(customer.id, selectedMode);

  try {
    const mollie = getMollieClient(selectedMode);
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
        preferredMode: selectedMode,
        strictMode: true,
      });
    }

    revalidatePath("/");
    revalidatePath("/customers");
    revalidatePath("/payments");
    revalidatePath("/notifications");
    redirectWithMessage(returnTo, {
      notice: "Customer state refreshed from Mollie.",
    });
  } catch (error) {
    unstable_rethrow(error);
    redirectWithMessage(returnTo, {
      error: serializeError(error),
    });
  }
}

export async function createSubscriptionAction(formData: FormData) {
  const parsed = createSubscriptionSchema.safeParse({
    amountValue: formData.get("amountValue"),
    customerId: formData.get("customerId"),
    description: formData.get("description"),
    interval: formData.get("interval") || undefined,
    returnTo: formData.get("returnTo") || undefined,
    startDate: formData.get("startDate") || undefined,
  });

  if (!parsed.success) {
    redirectWithMessage("/customers", {
      error: parsed.error.issues[0]?.message ?? "Enter a valid subscription.",
    });
  }

  await requireViewerSession();

  const selectedMode = await getSelectedMollieMode();
  const detail = await getCustomerDetail(parsed.data.customerId, selectedMode);
  const returnTo = updatePath(parsed.data.returnTo, {
    focus: parsed.data.customerId,
  });

  if (!detail || !detail.customer.mollieCustomerId) {
    redirectWithMessage("/customers", {
      error: "Customer not found in the selected Mollie mode or not linked to Mollie.",
    });
  }

  if (detail.customer.archivedAt) {
    redirectWithMessage(returnTo, {
      error: "Restore this customer before creating a subscription.",
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
    redirectWithMessage(returnTo, {
      error: "A successful first payment is required before creating the subscription.",
    });
  }

  if (!preferredMandate) {
    redirectWithMessage(returnTo, {
      error:
        "No pending or valid direct debit mandate is available yet. Sync the customer first.",
    });
  }

  if (existingSubscription) {
    redirectWithMessage(returnTo, {
      error:
        "This customer already has a local subscription record in progress or active. Review it before creating another one.",
    });
  }

  try {
    const amountValue = normalizeAmountValue(parsed.data.amountValue);
    const startDate = parsed.data.startDate?.length
      ? parsed.data.startDate
      : toNextMonthlyStartDate(latestPaidFirstPayment.paidAt!);
    const intervalMap = {
      monthly: "1 month",
      weekly: "1 week",
      yearly: "12 months",
    } as const;
    const mollieInterval = intervalMap[parsed.data.interval];
    const mollie = getMollieClient(selectedMode);
    const localSubscriptionId = crypto.randomUUID();
    const subscription = await mollie.customerSubscriptions.create({
      amount: {
        currency: "EUR",
        value: amountValue,
      },
      customerId: mollieCustomerId,
      description: parsed.data.description,
      idempotencyKey: crypto.randomUUID(),
      interval: mollieInterval,
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
            ${selectedMode},
            ${subscription.id},
            ${mapSubscriptionLifecycle(subscription.status)},
            ${subscription.status},
            ${subscription.description},
            ${subscription.interval},
            ${subscription.amount.value},
            ${subscription.amount.currency},
            ${new Date(startDate).getUTCDate()},
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
          mode: selectedMode,
          outcome: "success",
          summary: "Created a monthly subscription from a verified first payment.",
        },
        client,
      );
    });

    revalidatePath("/");
    revalidatePath("/customers");
    revalidatePath("/payments");
    redirectWithMessage(returnTo, {
      notice: "Subscription created. Future charges are now scheduled in Mollie.",
    });
  } catch (error) {
    unstable_rethrow(error);
    redirectWithMessage(returnTo, {
      error: serializeError(error),
    });
  }
}
