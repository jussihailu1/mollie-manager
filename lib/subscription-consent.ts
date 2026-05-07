import "server-only";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/lib/db";

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

const consentTokenSchema = z.string().trim().min(8).max(200);

const acceptConsentSchema = z.object({
  cancellationPolicyAck: z.string().optional(),
  recurringTermsAck: z.string().optional(),
  token: consentTokenSchema,
});

export type SubscriptionConsentRecord = {
  acceptedAt: string | null;
  acceptedCheckboxKeys: string[];
  businessName: string | null;
  checkoutUrl: string | null;
  consentToken: string;
  customerId: string;
  firstPaymentMode: "real_installment" | "mandate_only";
  mode: "test" | "live";
  paymentLinkId: string;
  planSnapshot: z.infer<typeof subscriptionConsentPlanSnapshotSchema>;
  requiredCheckboxKeys: string[];
  termsVersion: string;
};

function buildUrl(token: string, params: Record<string, string | null | undefined> = {}) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (!value) {
      continue;
    }

    search.set(key, value);
  }

  const searchString = search.toString();
  return `/subscribe/${token}${searchString ? `?${searchString}` : ""}`;
}

export async function getSubscriptionConsentByToken(token: string) {
  const parsedToken = consentTokenSchema.safeParse(token);

  if (!parsedToken.success) {
    return null;
  }

  const result = await getDb().execute<{
    acceptedAt: string | null;
    acceptedCheckboxKeys: unknown;
    businessName: string | null;
    checkoutUrl: string | null;
    consentToken: string;
    customerId: string;
    firstPaymentMode: "real_installment" | "mandate_only";
    mode: "test" | "live";
    paymentLinkId: string;
    planSnapshot: unknown;
    requiredCheckboxKeys: unknown;
    termsVersion: string;
  }>(sql`
    select
      soc.mode,
      soc.customer_id as "customerId",
      soc.payment_link_id as "paymentLinkId",
      soc.consent_token as "consentToken",
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
    where soc.consent_token = ${parsedToken.data}
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

  return {
    acceptedAt: row.acceptedAt,
    acceptedCheckboxKeys: Array.isArray(row.acceptedCheckboxKeys)
      ? row.acceptedCheckboxKeys.filter((value): value is string => typeof value === "string")
      : [],
    businessName: row.businessName,
    checkoutUrl: row.checkoutUrl,
    consentToken: row.consentToken,
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

export async function acceptSubscriptionConsentAction(formData: FormData) {
  "use server";

  const parsed = acceptConsentSchema.safeParse({
    cancellationPolicyAck: formData.get("cancellationPolicyAck") || undefined,
    recurringTermsAck: formData.get("recurringTermsAck") || undefined,
    token: formData.get("token"),
  });

  if (!parsed.success) {
    const token = String(formData.get("token") || "");
    redirect(buildUrl(token, { error: "consent_form_invalid" }));
  }

  const consent = await getSubscriptionConsentByToken(parsed.data.token);

  if (!consent) {
    redirect(buildUrl(parsed.data.token, { error: "consent_not_found" }));
  }

  if (!consent.checkoutUrl) {
    redirect(buildUrl(parsed.data.token, { error: "checkout_missing" }));
  }

  if (consent.acceptedAt) {
    redirect(consent.checkoutUrl);
  }

  const acknowledgedKeys = [
    parsed.data.recurringTermsAck ? "recurring_terms_ack" : null,
    parsed.data.cancellationPolicyAck ? "cancellation_policy_ack" : null,
  ].filter((value): value is string => value !== null);

  const missingKey = consent.requiredCheckboxKeys.find(
    (requiredKey) => !acknowledgedKeys.includes(requiredKey),
  );

  if (missingKey) {
    redirect(buildUrl(parsed.data.token, { error: "consent_required" }));
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
      accepted_checkbox_keys = ${JSON.stringify(acknowledgedKeys)}::jsonb,
      accepted_at = now(),
      accepted_ip = ${acceptedIp},
      accepted_user_agent = ${acceptedUserAgent},
      updated_at = now()
    where consent_token = ${consent.consentToken}
      and accepted_at is null
  `);

  redirect(consent.checkoutUrl);
}

