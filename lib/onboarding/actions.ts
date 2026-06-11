"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { sql } from "drizzle-orm";
import {
  Locale,
  PaymentMethod,
  SequenceType,
} from "@mollie/api-client";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit";
import { requireViewerSession } from "@/lib/auth/session";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { transaction } from "@/lib/db";
import {
  getEboekhoudenRelation,
  toPublicEboekhoudenError,
  updateEboekhoudenRelation,
} from "@/lib/eboekhouden/client";
import {
  localFieldsToRelationPatch,
  type LocalRelationFields,
} from "@/lib/eboekhouden/relation-mapping";
import { getMollieClient, getMollieWebhookUrl } from "@/lib/mollie/client";
import { attemptSubscriptionActivation } from "@/lib/onboarding/subscription-activation";
import { buildConsentLinkCreatedNotice } from "@/lib/onboarding/consent-link";
import {
  shouldPatchEboekhoudenRelation,
  toCustomerRelationFields,
} from "@/lib/onboarding/customer-relation-fields";
import {
  resolveCustomerArchiveBlocker,
  resolveCustomerRestoreBlocker,
} from "@/lib/onboarding/customer-archive-policy";
import { repairCustomerBillingState as repairCustomerBillingStateImpl } from "@/lib/onboarding/customer-billing-repair";
import {
  buildConsentTokenStorage,
  createConsentToken,
} from "@/lib/onboarding/consent-token-storage";
import { updateActionPath } from "@/lib/onboarding/action-path";
import { getCustomerDetail } from "@/lib/onboarding/data";
import { resolveFirstPaymentCreationBlocker } from "@/lib/onboarding/first-payment-blocker";
import { buildFirstPaymentPlan } from "@/lib/onboarding/first-payment-plan";
import { buildFirstPaymentOnboardingRecords } from "@/lib/onboarding/first-payment-onboarding-records";
import { buildSubscriptionConsentReturnUrl } from "@/lib/subscription-consent";
import { ensureTenantSubscriptionPolicyDefaults } from "@/lib/subscription-policy-defaults";
export const repairCustomerBillingState = repairCustomerBillingStateImpl;

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
  customerId: z.string().uuid(),
  firstPaymentMode: z
    .enum(["real_installment", "mandate_only"])
    .default("real_installment"),
  returnTo: z.string().trim().startsWith("/").default("/customers"),
  serviceEndAt: z.string().trim().optional(),
  subscriptionAmountValue: z.string().trim().min(1),
  subscriptionDescription: z.string().trim().min(2).max(140),
  subscriptionInterval: z.enum(["weekly", "monthly", "yearly"]).default("monthly"),
  subscriptionStartDate: z.string().trim().min(1),
  subscriptionTermMode: z.enum(["open_ended", "fixed_term"]).default("open_ended"),
  totalPayments: z
    .union([z.string().trim().length(0), z.coerce.number().int().positive()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === "") {
        return null;
      }

      return Number(value);
    }),
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
  customerId: z.string().uuid(),
  returnTo: z.string().trim().startsWith("/").default("/customers"),
});

function redirectWithMessage(
  pathname: string,
  options: { error?: string; notice?: string },
): never {
  redirect(
    updateActionPath(pathname, {
      error: options.error,
      notice: options.notice,
    }),
  );
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

async function updateRelationFromLocalFields(
  relationId: number,
  fields: LocalRelationFields,
) {
  const relation = await getEboekhoudenRelation(relationId);

  if (!shouldPatchEboekhoudenRelation(relation, fields)) {
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
  const returnTo = updateActionPath(parsed.data.returnTo, {
    focus: null,
  });

  if (!detail) {
    redirectWithMessage(returnTo, {
      error: "Customer not found in the selected Mollie mode.",
    });
  }

  const archiveBlocker = resolveCustomerArchiveBlocker({
    archivedAt: detail.customer.archivedAt,
    subscriptions: detail.subscriptions,
  });

  if (archiveBlocker) {
    redirectWithMessage(returnTo, {
      error: archiveBlocker.kind === "error" ? archiveBlocker.message : undefined,
      notice: archiveBlocker.kind === "notice" ? archiveBlocker.message : undefined,
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
  const returnTo = updateActionPath(parsed.data.returnTo, {
    focus: parsed.data.customerId,
    view: null,
  });

  if (!detail) {
    redirectWithMessage(returnTo, {
      error: "Customer not found in the selected Mollie mode.",
    });
  }

  const restoreBlocker = resolveCustomerRestoreBlocker(detail.customer.archivedAt);

  if (restoreBlocker) {
    redirectWithMessage(returnTo, {
      notice: restoreBlocker.message,
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
    const relationFields = toCustomerRelationFields(parsed.data);
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

    const returnTo = updateActionPath(parsed.data.returnTo, {
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
  const returnTo = updateActionPath(parsed.data.returnTo, {
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

    const relationFields = toCustomerRelationFields(parsed.data);
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
    customerId: formData.get("customerId"),
    firstPaymentMode: formData.get("firstPaymentMode") || undefined,
    returnTo: formData.get("returnTo") || undefined,
    serviceEndAt: formData.get("serviceEndAt") || undefined,
    subscriptionAmountValue: formData.get("subscriptionAmountValue"),
    subscriptionDescription: formData.get("subscriptionDescription"),
    subscriptionInterval: formData.get("subscriptionInterval") || undefined,
    subscriptionStartDate: formData.get("subscriptionStartDate"),
    subscriptionTermMode: formData.get("subscriptionTermMode") || undefined,
    totalPayments: formData.get("totalPayments") || undefined,
  });

  if (!parsed.success) {
    redirectWithMessage("/customers", {
      error: parsed.error.issues[0]?.message ?? "Enter a valid first payment.",
    });
  }

  await requireViewerSession();

  const selectedMode = await getSelectedMollieMode();
  const customer = await getLocalCustomer(parsed.data.customerId, selectedMode);
  const returnTo = updateActionPath(parsed.data.returnTo, {
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
  const firstPaymentBlocker = resolveFirstPaymentCreationBlocker({
    paymentLinks: detail?.paymentLinks ?? [],
    payments: detail?.payments ?? [],
  });

  if (firstPaymentBlocker) {
    redirectWithMessage(returnTo, {
      error: firstPaymentBlocker,
    });
  }

  try {
    const tenantPolicy = await ensureTenantSubscriptionPolicyDefaults();
    const firstPaymentPlan = buildFirstPaymentPlan({
      firstPaymentMode: parsed.data.firstPaymentMode,
      serviceEndAt: parsed.data.serviceEndAt,
      subscriptionAmountValue: parsed.data.subscriptionAmountValue,
      subscriptionDescription: parsed.data.subscriptionDescription,
      subscriptionInterval: parsed.data.subscriptionInterval,
      subscriptionStartDate: parsed.data.subscriptionStartDate,
      subscriptionTermMode: parsed.data.subscriptionTermMode,
      tenantPolicy: {
        cancellationEmail: tenantPolicy.cancellationEmail,
        defaultCancellationEffect: tenantPolicy.defaultCancellationEffect,
        privacyUrl: tenantPolicy.privacyUrl,
        termsUrl: tenantPolicy.termsUrl,
        termsVersion: tenantPolicy.termsVersion,
      },
      totalPayments: parsed.data.totalPayments,
    });
    const mollie = getMollieClient(selectedMode);
    const localPaymentLinkId = crypto.randomUUID();
    const localConsentId = crypto.randomUUID();
    const consentToken = createConsentToken();
    const consentTokenStorage = buildConsentTokenStorage(consentToken);
    const webhookUrl = getMollieWebhookUrl();
    const redirectUrl = buildSubscriptionConsentReturnUrl(consentToken);
    const paymentLink = await mollie.paymentLinks.create({
      allowedMethods: [PaymentMethod.ideal],
      amount: {
        currency: "EUR",
        value: firstPaymentPlan.amountValue,
      },
      customerId: mollieCustomerId,
      description: firstPaymentPlan.paymentDescription,
      idempotencyKey: crypto.randomUUID(),
      redirectUrl,
      reusable: false,
      sequenceType: SequenceType.first,
      webhookUrl,
    });
    const onboardingRecords = buildFirstPaymentOnboardingRecords({
      consentTokenStorage,
      customerId: customer.id,
      fallbackAmountValue: firstPaymentPlan.amountValue,
      firstPaymentMode: parsed.data.firstPaymentMode,
      localConsentId,
      localPaymentLinkId,
      mollieCustomerId,
      paymentLink,
      planSnapshot: firstPaymentPlan.planSnapshot,
      redirectUrl,
      selectedMode,
      termsVersion: tenantPolicy.termsVersion,
    });

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
            ${onboardingRecords.auditDetails.localPaymentLinkId},
            ${onboardingRecords.paymentLinkRecord.customerId},
            ${onboardingRecords.paymentLinkRecord.mode},
            ${onboardingRecords.paymentLinkRecord.molliePaymentLinkId},
            ${onboardingRecords.paymentLinkRecord.mollieStatus},
            ${onboardingRecords.paymentLinkRecord.description},
            ${onboardingRecords.paymentLinkRecord.amountValue},
            ${onboardingRecords.paymentLinkRecord.amountCurrency},
            ${onboardingRecords.paymentLinkRecord.checkoutUrl},
            ${onboardingRecords.paymentLinkRecord.expiresAt}::timestamptz,
            ${JSON.stringify(onboardingRecords.paymentLinkRecord.metadata)}::jsonb,
            coalesce(${onboardingRecords.paymentLinkRecord.createdAt}::timestamptz, now()),
            now(),
            now()
          )
        `);
      await client.execute(sql`
          insert into subscription_onboarding_consents (
            id,
            mode,
            customer_id,
            payment_link_id,
            consent_token,
            consent_token_hash,
            consent_token_ciphertext,
            first_payment_mode,
            terms_version,
            required_checkbox_keys,
            accepted_checkbox_keys,
            plan_snapshot,
            accepted_at,
            accepted_ip,
            accepted_user_agent,
            created_at,
            updated_at
          ) values (
            ${onboardingRecords.consentRecord.id},
            ${onboardingRecords.consentRecord.mode},
            ${onboardingRecords.consentRecord.customerId},
            ${onboardingRecords.consentRecord.paymentLinkId},
            ${onboardingRecords.consentRecord.consentToken},
            ${onboardingRecords.consentRecord.consentTokenHash},
            ${onboardingRecords.consentRecord.consentTokenCiphertext},
            ${onboardingRecords.consentRecord.firstPaymentMode},
            ${onboardingRecords.consentRecord.termsVersion},
            ${JSON.stringify(onboardingRecords.consentRecord.requiredCheckboxKeys)}::jsonb,
            ${JSON.stringify(onboardingRecords.consentRecord.acceptedCheckboxKeys)}::jsonb,
            ${JSON.stringify(onboardingRecords.consentRecord.planSnapshot)}::jsonb,
            ${onboardingRecords.consentRecord.acceptedAt},
            ${onboardingRecords.consentRecord.acceptedIp},
            ${onboardingRecords.consentRecord.acceptedUserAgent},
            now(),
            now()
          )
        `);

      await writeAuditLog(
        {
          action: "payment_link.first.create",
          details: onboardingRecords.auditDetails,
          entityId: onboardingRecords.auditDetails.localPaymentLinkId,
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
      notice: buildConsentLinkCreatedNotice(),
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
  const returnTo = updateActionPath(parsed.data.returnTo, {
    focus: parsed.data.customerId,
  });

  try {
    const result = await repairCustomerBillingState({
      actor: {
        email: session.user.email ?? null,
        kind: "user",
      },
      customerId: parsed.data.customerId,
      mode: selectedMode,
    });

    if (result.status === "skipped") {
      const message =
        result.reason === "archived"
          ? "Restore this customer before repairing billing state."
          : result.reason === "not_linked"
            ? "Customer is not linked to Mollie."
            : "Customer not found in the selected Mollie mode.";

      redirectWithMessage(returnTo, {
        error: message,
      });
    }

    revalidatePath("/");
    revalidatePath("/customers");
    revalidatePath("/payments");
    revalidatePath("/notifications");
    redirectWithMessage(returnTo, {
      notice: "Customer state repaired from Mollie.",
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
    customerId: formData.get("customerId"),
    returnTo: formData.get("returnTo") || undefined,
  });

  if (!parsed.success) {
    redirectWithMessage("/customers", {
      error: parsed.error.issues[0]?.message ?? "Enter a valid subscription.",
    });
  }

  const session = await requireViewerSession();
  const selectedMode = await getSelectedMollieMode();
  const returnTo = updateActionPath(parsed.data.returnTo, {
    focus: parsed.data.customerId,
  });

  try {
    const result = await attemptSubscriptionActivation({
      actor: {
        email: session.user.email ?? null,
        kind: "user",
      },
      customerId: parsed.data.customerId,
      mode: selectedMode,
      trigger: "manual",
    });

    if (result.status === "created") {
      revalidatePath("/");
      revalidatePath("/customers");
      revalidatePath("/payments");
      revalidatePath("/notifications");
      redirectWithMessage(returnTo, {
        notice:
          result.firstPaymentMode === "real_installment"
            ? "Subscription activation retried successfully. Future charges are now scheduled in Mollie."
            : "Subscription created. Future charges are now scheduled in Mollie.",
      });
    }

    if (result.status === "already_exists") {
      redirectWithMessage(returnTo, {
        notice:
          result.reason === "consent_already_used"
            ? "A subscription already exists for this onboarding flow."
            : "This customer already has a local subscription record in progress or active.",
      });
    }

    if (result.status === "skipped") {
      redirectWithMessage(returnTo, {
        error:
          "This onboarding flow is mandate-only. Create the recurring subscription manually when you are ready.",
      });
    }

    if (result.status === "pending_prerequisites") {
      const error =
        result.reason === "archived"
          ? "Restore this customer before creating a subscription."
          : result.reason === "customer_not_linked"
            ? "Customer not found in the selected Mollie mode or not linked to Mollie."
            : result.reason === "missing_consent"
              ? "No accepted consent was found yet. Complete the consent flow first."
              : result.reason === "missing_mandate"
                ? "No pending or valid direct debit mandate is available yet. Sync the customer first."
                : "A successful first payment is required before creating the subscription.";

      redirectWithMessage(returnTo, {
        error,
      });
    }

    redirectWithMessage(returnTo, {
      error: result.message,
    });
  } catch (error) {
    unstable_rethrow(error);
    redirectWithMessage(returnTo, {
      error: serializeError(error),
    });
  }
}
