import "server-only";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import {
  buildSubscriptionConsentPath,
  consentTokenSchema,
  findMissingRequiredConsentKey,
  parseConsentAcceptanceInput,
} from "@/lib/subscription-consent-acceptance";
import {
  buildConsentTokenStorage,
  hashConsentToken,
  resolveStoredConsentToken,
} from "@/lib/onboarding/consent-token-storage";
import {
  buildRecurringBillingConsentSnapshot,
} from "@/lib/recurring-billing-policy";

const recurringBillingConsentSnapshotSchema = z
  .object({
    automaticCollectionOnPlannedDate: z.literal(true),
    invoiceNoticeDaysBeforeDueDate: z.number().int().positive(),
    invoicePreNotificationMethod: z.literal("invoice_email"),
    invoiceSentBeforeAutomaticCollection: z.literal(true),
    mandateOnlySetupPaymentExcludedFromRecurringInvoice: z.boolean(),
    sepaDirectDebitCanFailOrBeReversed: z.literal(true),
    sepaPendingReturnWindowDays: z.number().int().positive(),
    shorterSepaPreNotificationAgreed: z.literal(true),
  })
  .default(buildRecurringBillingConsentSnapshot({ firstPaymentMode: "real_installment" }));

export const subscriptionConsentPlanSnapshotSchema = z.object({
  amountCurrency: z.literal("EUR"),
  billingInterval: z.enum(["weekly", "monthly", "yearly"]),
  cancellationEffect: z.enum(["immediate", "end_of_paid_period"]),
  cancellationEmail: z.string().email(),
  cancellationMethod: z.literal("email"),
  description: z.string().min(2),
  finalChargeDate: z.string().nullable(),
  firstPaymentAmountValue: z.string(),
  firstPaymentMode: z.enum(["real_installment", "mandate_only"]),
  recurringBilling: recurringBillingConsentSnapshotSchema,
  recurringChargeCount: z.number().int().nullable(),
  serviceEndAt: z.string().nullable(),
  startDate: z.string(),
  subscriptionAmountValue: z.string(),
  subscriptionTermMode: z.enum(["open_ended", "fixed_term"]),
  termsPrivacy: z.object({
    privacyUrl: z.string().url(),
    termsUrl: z.string().url(),
    termsVersion: z.string().min(1),
  }),
  totalPayments: z.number().int().nullable(),
});

export type SubscriptionConsentRecord = {
  acceptedAt: string | null;
  acceptedCheckboxKeys: string[];
  businessName: string | null;
  checkoutUrl: string | null;
  consentId: string;
  consentToken: string;
  customerId: string;
  firstPaymentMode: "real_installment" | "mandate_only";
  mode: "test" | "live";
  paymentLinkId: string;
  planSnapshot: z.infer<typeof subscriptionConsentPlanSnapshotSchema>;
  requiredCheckboxKeys: string[];
  termsVersion: string;
};

export type SubscriptionOnboardingReturnRecord = {
  acceptedAt: string | null;
  businessName: string | null;
  consentId: string;
  consentToken: string;
  firstPaymentMode: "real_installment" | "mandate_only";
  firstPaymentStatus: string | null;
  paymentLinkStatus: string | null;
  subscriptionStatus: string | null;
};

export function buildSubscriptionConsentReturnPath(token: string) {
  return `/subscribe/${token}/return`;
}

export function buildSubscriptionConsentReturnUrl(token: string) {
  return new URL(buildSubscriptionConsentReturnPath(token), env.APP_URL).toString();
}

type StoredConsentTokenRow = {
  consentId: string;
  consentToken: string | null;
  consentTokenCiphertext: string | null;
  consentTokenHash: string | null;
};

async function ensureStoredConsentToken(row: StoredConsentTokenRow) {
  const consentToken = resolveStoredConsentToken(row);

  if (!consentToken) {
    return null;
  }

  if (row.consentTokenHash && row.consentTokenCiphertext && !row.consentToken) {
    return consentToken;
  }

  const storage = buildConsentTokenStorage(consentToken);

  await getDb().execute(sql`
    update subscription_onboarding_consents
    set
      consent_token = null,
      consent_token_hash = ${storage.consentTokenHash},
      consent_token_ciphertext = ${storage.consentTokenCiphertext},
      updated_at = now()
    where id = ${row.consentId}
      and (
        consent_token is not null
        or consent_token_hash is null
        or consent_token_ciphertext is null
      )
  `);

  return consentToken;
}

export async function getSubscriptionConsentByToken(token: string) {
  const parsedToken = consentTokenSchema.safeParse(token);

  if (!parsedToken.success) {
    return null;
  }

  const consentTokenHash = hashConsentToken(parsedToken.data);

  const result = await getDb().execute<{
    acceptedAt: string | null;
    acceptedCheckboxKeys: unknown;
    businessName: string | null;
    checkoutUrl: string | null;
    consentId: string;
    consentToken: string | null;
    consentTokenCiphertext: string | null;
    consentTokenHash: string | null;
    customerId: string;
    firstPaymentMode: "real_installment" | "mandate_only";
    mode: "test" | "live";
    paymentLinkId: string;
    planSnapshot: unknown;
    requiredCheckboxKeys: unknown;
    termsVersion: string;
  }>(sql`
    select
      soc.id as "consentId",
      soc.mode,
      soc.customer_id as "customerId",
      soc.payment_link_id as "paymentLinkId",
      soc.consent_token as "consentToken",
      soc.consent_token_ciphertext as "consentTokenCiphertext",
      soc.consent_token_hash as "consentTokenHash",
      soc.first_payment_mode as "firstPaymentMode",
      soc.terms_version as "termsVersion",
      soc.required_checkbox_keys as "requiredCheckboxKeys",
      soc.accepted_checkbox_keys as "acceptedCheckboxKeys",
      soc.plan_snapshot as "planSnapshot",
      soc.accepted_at as "acceptedAt",
      pl.checkout_url as "checkoutUrl",
      coalesce(nullif(c.metadata ->> 'businessName', ''), c.full_name) as "businessName"
    from subscription_onboarding_consents soc
    inner join payment_links pl on pl.id = soc.payment_link_id and pl.mode = soc.mode
    inner join customers c on c.id = soc.customer_id and c.mode = soc.mode
    where
      soc.consent_token_hash = ${consentTokenHash}
      or soc.consent_token = ${parsedToken.data}
    order by
      case
        when soc.consent_token_hash = ${consentTokenHash} then 0
        else 1
      end,
      soc.created_at desc
    limit 1
  `);

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  const parsedSnapshot = subscriptionConsentPlanSnapshotSchema.safeParse(row.planSnapshot);

  if (!parsedSnapshot.success) {
    throw new Error("Stored consent snapshot is invalid.");
  }

  const storedConsentToken = await ensureStoredConsentToken(row);

  if (!storedConsentToken) {
    return null;
  }

  return {
    acceptedAt: row.acceptedAt,
    acceptedCheckboxKeys: Array.isArray(row.acceptedCheckboxKeys)
      ? row.acceptedCheckboxKeys.filter((value): value is string => typeof value === "string")
      : [],
    businessName: row.businessName,
    checkoutUrl: row.checkoutUrl,
    consentId: row.consentId,
    consentToken: storedConsentToken,
    customerId: row.customerId,
    firstPaymentMode: row.firstPaymentMode,
    mode: row.mode,
    paymentLinkId: row.paymentLinkId,
    planSnapshot: parsedSnapshot.data,
    requiredCheckboxKeys: Array.isArray(row.requiredCheckboxKeys)
      ? row.requiredCheckboxKeys.filter((value): value is string => typeof value === "string")
      : [],
    termsVersion: row.termsVersion,
  } satisfies SubscriptionConsentRecord;
}

export async function getSubscriptionOnboardingReturnRecord(token: string) {
  const parsedToken = consentTokenSchema.safeParse(token);

  if (!parsedToken.success) {
    return null;
  }

  const consentTokenHash = hashConsentToken(parsedToken.data);

  const result = await getDb().execute<{
    acceptedAt: string | null;
    businessName: string | null;
    consentId: string;
    consentToken: string | null;
    consentTokenCiphertext: string | null;
    consentTokenHash: string | null;
    firstPaymentMode: "real_installment" | "mandate_only";
    firstPaymentStatus: string | null;
    paymentLinkStatus: string | null;
    subscriptionStatus: string | null;
  }>(sql`
    select
      soc.id as "consentId",
      soc.consent_token as "consentToken",
      soc.consent_token_ciphertext as "consentTokenCiphertext",
      soc.consent_token_hash as "consentTokenHash",
      soc.accepted_at as "acceptedAt",
      soc.first_payment_mode as "firstPaymentMode",
      pl.mollie_status as "paymentLinkStatus",
      pl.metadata ->> 'latestPaymentStatus' as "firstPaymentStatus",
      created_subscription.local_status as "subscriptionStatus",
      coalesce(nullif(c.metadata ->> 'businessName', ''), c.full_name) as "businessName"
    from subscription_onboarding_consents soc
    inner join payment_links pl on pl.id = soc.payment_link_id and pl.mode = soc.mode
    inner join customers c on c.id = soc.customer_id and c.mode = soc.mode
    left join lateral (
      select s.local_status
      from subscriptions s
      where
        s.customer_id = soc.customer_id
        and s.mode = soc.mode
        and s.metadata ->> 'consentId' = soc.id
      order by s.created_at desc
      limit 1
    ) created_subscription on true
    where
      soc.consent_token_hash = ${consentTokenHash}
      or soc.consent_token = ${parsedToken.data}
    order by
      case
        when soc.consent_token_hash = ${consentTokenHash} then 0
        else 1
      end,
      soc.created_at desc
    limit 1
  `);

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  const storedConsentToken = await ensureStoredConsentToken(row);

  if (!storedConsentToken) {
    return null;
  }

  return {
    ...row,
    consentToken: storedConsentToken,
  } satisfies SubscriptionOnboardingReturnRecord;
}

export async function acceptSubscriptionConsentAction(formData: FormData) {
  "use server";

  const parsed = parseConsentAcceptanceInput({
    cancellationPolicyAck: formData.get("cancellationPolicyAck"),
    recurringBillingPolicyAck: formData.get("recurringBillingPolicyAck"),
    recurringTermsAck: formData.get("recurringTermsAck"),
    token: formData.get("token"),
  });

  if (!parsed.success) {
    redirect(
      buildSubscriptionConsentPath(parsed.tokenForRedirect, {
        error: "consent_form_invalid",
      }),
    );
  }

  const consent = await getSubscriptionConsentByToken(parsed.token);

  if (!consent) {
    redirect(buildSubscriptionConsentPath(parsed.token, { error: "consent_not_found" }));
  }

  if (!consent.checkoutUrl) {
    redirect(buildSubscriptionConsentPath(parsed.token, { error: "checkout_missing" }));
  }

  if (consent.acceptedAt) {
    redirect(consent.checkoutUrl);
  }

  const missingKey = findMissingRequiredConsentKey(
    consent.requiredCheckboxKeys,
    parsed.acknowledgedKeys,
  );

  if (missingKey) {
    redirect(buildSubscriptionConsentPath(parsed.token, { error: "consent_required" }));
  }

  const headerStore = await headers();
  const acceptedIp =
    headerStore
      .get("x-forwarded-for")
      ?.split(",")
      .map((part) => part.trim())
      .find(Boolean) ?? null;
  const acceptedUserAgent = headerStore.get("user-agent") ?? null;

  await getDb().execute(sql`
    update subscription_onboarding_consents
    set
      accepted_checkbox_keys = ${JSON.stringify(parsed.acknowledgedKeys)}::jsonb,
      accepted_at = now(),
      accepted_ip = ${acceptedIp},
      accepted_user_agent = ${acceptedUserAgent},
      updated_at = now()
    where id = ${consent.consentId}
      and accepted_at is null
  `);

  redirect(consent.checkoutUrl);
}

