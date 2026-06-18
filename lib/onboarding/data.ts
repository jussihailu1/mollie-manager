import "server-only";

import { sql } from "drizzle-orm";
import { cache } from "react";

import type { DashboardModeFilter } from "@/lib/dashboard-mode";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { buildConsentLinkUrl } from "@/lib/onboarding/consent-link";
import {
  buildConsentTokenStorage,
  resolveStoredConsentToken,
} from "@/lib/onboarding/consent-token-storage";

export type CustomerOverview = {
  address: string | null;
  businessName: string | null;
  contactName: string | null;
  createdAt: string;
  archivedAt: string | null;
  eboekhoudenLinkStatus: "linked" | "unlinked" | "needs_review" | "sync_error";
  eboekhoudenRelationCode: string | null;
  eboekhoudenRelationId: number | null;
  eboekhoudenSyncedAt: string | null;
  email: string;
  fullName: string | null;
  hasValidMandate: boolean;
  id: string;
  latestPaymentAmountCurrency: string | null;
  latestPaymentAmountValue: string | null;
  latestPaymentCreatedAt: string | null;
  latestPaymentId: string | null;
  latestPaymentPaidAt: string | null;
  latestPaymentStatus: string | null;
  latestPaymentType: "first" | "recurring" | null;
  latestFirstPaymentCheckoutUrl: string | null;
  latestFirstPaymentId: string | null;
  latestFirstPaymentLinkId: string | null;
  latestFirstPaymentLinkStatus: string | null;
  latestFirstPaymentLinkUrl: string | null;
  latestConsentAcceptedAt: string | null;
  latestFirstPaymentMode: "real_installment" | "mandate_only" | null;
  latestFirstPaymentPaidAt: string | null;
  latestFirstPaymentStatus: string | null;
  latestMandateId: string | null;
  latestMandateStatus: string | null;
  latestSubscriptionId: string | null;
  latestSubscriptionAmountCurrency: string | null;
  latestSubscriptionAmountValue: string | null;
  latestSubscriptionDescription: string | null;
  latestSubscriptionInterval: string | null;
  latestSubscriptionCancellationEffect: "immediate" | "end_of_paid_period" | null;
  latestSubscriptionLastChargeDate: string | null;
  latestSubscriptionMollieStatus: string | null;
  latestSubscriptionNextPaymentDate: string | null;
  latestSubscriptionServiceEndAt: string | null;
  latestSubscriptionStartDate: string | null;
  latestSubscriptionStatus: string | null;
  latestSubscriptionStopAfterCurrentPeriod: boolean | null;
  latestSubscriptionTermMode: "open_ended" | "fixed_term" | null;
  latestSubscriptionTotalPayments: number | null;
  lastSyncedAt: string | null;
  mode: "live" | "test";
  mollieCustomerId: string | null;
  notes: string | null;
  phone: string | null;
  subscriptionCount: number;
};

export type PaymentRecord = {
  amountCurrency: string;
  amountValue: string;
  checkoutUrl: string | null;
  createdAt: string;
  expiresAt: string | null;
  failedAt: string | null;
  id: string;
  mandateId: string | null;
  method: string | null;
  molliePaymentId: string | null;
  mollieStatus: string | null;
  paidAt: string | null;
  paymentType: string;
  sequenceType: string | null;
};

export type PaymentLinkRecord = {
  amountCurrency: string;
  amountValue: string;
  checkoutUrl: string | null;
  createdAt: string;
  description: string;
  expiresAt: string | null;
  id: string;
  metadata: Record<string, unknown>;
  molliePaymentLinkId: string | null;
  mollieStatus: string | null;
  lastSyncedAt: string | null;
};

export type MandateRecord = {
  createdAt: string;
  details: Record<string, unknown>;
  id: string;
  isValid: boolean;
  method: string | null;
  mollieMandateId: string;
  mollieStatus: string | null;
};

export type SubscriptionRecord = {
  amountCurrency: string;
  amountValue: string;
  billingDay: number | null;
  canceledAt: string | null;
  cancellationEffect: "immediate" | "end_of_paid_period";
  createdAt: string;
  description: string;
  id: string;
  interval: string;
  lastChargeDate: string | null;
  localStatus: string;
  mandateId: string | null;
  lastSyncedAt: string | null;
  mollieStatus: string | null;
  nextPaymentDate: string | null;
  serviceEndAt: string | null;
  startDate: string | null;
  stopAfterCurrentPeriod: boolean;
  subscriptionTermMode: "open_ended" | "fixed_term";
  totalPayments: number | null;
};

export type CustomerDetail = {
  customer: CustomerOverview;
  mandates: MandateRecord[];
  paymentLinks: PaymentLinkRecord[];
  payments: PaymentRecord[];
  subscriptions: SubscriptionRecord[];
};

export type SubscriptionOverview = {
  amountCurrency: string;
  amountValue: string;
  canceledAt: string | null;
  cancellationEffect: "immediate" | "end_of_paid_period";
  createdAt: string;
  customerEmail: string;
  customerId: string;
  customerName: string | null;
  description: string;
  id: string;
  interval: string;
  lastChargeDate: string | null;
  localStatus: string;
  mandateId: string | null;
  lastSyncedAt: string | null;
  mode: "live" | "test";
  mollieSubscriptionId: string | null;
  mollieStatus: string | null;
  nextPaymentDate: string | null;
  serviceEndAt: string | null;
  startDate: string | null;
  stopAfterCurrentPeriod: boolean;
  subscriptionTermMode: "open_ended" | "fixed_term";
  totalPayments: number | null;
};

export type PaymentOverview = {
  amountCurrency: string;
  amountValue: string;
  checkoutUrl: string | null;
  createdAt: string;
  customerEmail: string | null;
  customerId: string | null;
  customerName: string | null;
  failedAt: string | null;
  id: string;
  mandateId: string | null;
  method: string | null;
  lastSyncedAt: string | null;
  mode: "live" | "test";
  molliePaymentId: string | null;
  mollieStatus: string | null;
  paidAt: string | null;
  paymentType: string;
  sequenceType: string | null;
  subscriptionDescription: string | null;
  subscriptionId: string | null;
};

export type OperationalAlert = {
  createdAt: string;
  customerEmail: string | null;
  customerId: string | null;
  customerName: string | null;
  href: string;
  id: string;
  severity: "critical" | "warning";
  summary: string;
  title: string;
  type: "payment" | "subscription";
};

function toModeParam(mode?: DashboardModeFilter) {
  return !mode || mode === "all" ? null : mode;
}

const customerBusinessNameSelect = sql<string | null>`
  coalesce(nullif(c.metadata ->> 'businessName', ''), c.full_name)
`;

const customerContactNameSelect = sql<string | null>`
  coalesce(nullif(c.metadata ->> 'contactName', ''), c.full_name)
`;

const listCustomersByMode = cache(async (
  mode: DashboardModeFilter,
  archived: boolean,
) => {
  const modeParam = toModeParam(mode);
  const result = await getDb().execute<CustomerOverview>(sql`
      select
        c.id,
        c.mode,
        c.mollie_customer_id as "mollieCustomerId",
        c.eboekhouden_relation_id as "eboekhoudenRelationId",
        c.eboekhouden_relation_code as "eboekhoudenRelationCode",
        c.eboekhouden_link_status as "eboekhoudenLinkStatus",
        c.eboekhouden_synced_at as "eboekhoudenSyncedAt",
        c.full_name as "fullName",
        ${customerBusinessNameSelect} as "businessName",
        ${customerContactNameSelect} as "contactName",
        c.email,
        nullif(c.metadata ->> 'address', '') as "address",
        c.notes,
        nullif(c.metadata ->> 'phone', '') as "phone",
        c.created_at as "createdAt",
        c.archived_at as "archivedAt",
        latest_payment.id as "latestPaymentId",
        latest_payment.amount_currency as "latestPaymentAmountCurrency",
        latest_payment.amount_value::text as "latestPaymentAmountValue",
        latest_payment.created_at as "latestPaymentCreatedAt",
        latest_payment.paid_at as "latestPaymentPaidAt",
        latest_payment.mollie_status as "latestPaymentStatus",
        latest_payment.payment_type as "latestPaymentType",
        latest_first_payment.id as "latestFirstPaymentId",
        latest_first_payment.checkout_url as "latestFirstPaymentCheckoutUrl",
        latest_first_payment.mollie_status as "latestFirstPaymentStatus",
        latest_first_payment.paid_at as "latestFirstPaymentPaidAt",
        latest_payment_link.id as "latestFirstPaymentLinkId",
        latest_payment_link.checkout_url as "latestFirstPaymentLinkUrl",
        latest_payment_link.mollie_status as "latestFirstPaymentLinkStatus",
        latest_consent.accepted_at as "latestConsentAcceptedAt",
        latest_consent.first_payment_mode as "latestFirstPaymentMode",
        latest_mandate.id as "latestMandateId",
        latest_mandate.mollie_status as "latestMandateStatus",
        coalesce(latest_mandate.is_valid, false) as "hasValidMandate",
        latest_subscription.id as "latestSubscriptionId",
        latest_subscription.amount_currency as "latestSubscriptionAmountCurrency",
        latest_subscription.amount_value::text as "latestSubscriptionAmountValue",
        latest_subscription.description as "latestSubscriptionDescription",
        latest_subscription.interval as "latestSubscriptionInterval",
        latest_subscription.subscription_term_mode as "latestSubscriptionTermMode",
        latest_subscription.total_payments as "latestSubscriptionTotalPayments",
        latest_subscription.last_charge_date::text as "latestSubscriptionLastChargeDate",
        latest_subscription.service_end_at as "latestSubscriptionServiceEndAt",
        latest_subscription.cancellation_effect as "latestSubscriptionCancellationEffect",
        latest_subscription.mollie_status as "latestSubscriptionMollieStatus",
        latest_subscription.metadata ->> 'nextPaymentDate' as "latestSubscriptionNextPaymentDate",
        latest_subscription.start_date::text as "latestSubscriptionStartDate",
        latest_subscription.local_status as "latestSubscriptionStatus",
        latest_subscription.stop_after_current_period as "latestSubscriptionStopAfterCurrentPeriod",
        nullif(
          greatest(
            coalesce(c.last_synced_at, 'epoch'::timestamptz),
            coalesce(latest_payment.last_synced_at, 'epoch'::timestamptz),
            coalesce(latest_first_payment.last_synced_at, 'epoch'::timestamptz),
            coalesce(latest_payment_link.last_synced_at, 'epoch'::timestamptz),
            coalesce(latest_mandate.last_synced_at, 'epoch'::timestamptz),
            coalesce(latest_subscription.last_synced_at, 'epoch'::timestamptz)
          ),
          'epoch'::timestamptz
        ) as "lastSyncedAt",
        coalesce(subscription_counts.total, 0)::int as "subscriptionCount"
      from customers c
      left join lateral (
        select p.*
        from payments p
        where p.customer_id = c.id and p.mode = c.mode
        order by
          coalesce(p.paid_at, p.failed_at, p.created_at) desc,
          p.created_at desc
        limit 1
      ) latest_payment on true
      left join lateral (
        select p.*
        from payments p
        where p.customer_id = c.id and p.mode = c.mode and p.payment_type = 'first'
        order by p.created_at desc
        limit 1
      ) latest_first_payment on true
      left join lateral (
        select pl.*
        from payment_links pl
        where
          pl.customer_id = c.id
          and pl.mode = c.mode
          and pl.metadata ->> 'source' = 'subscription_onboarding'
          and pl.metadata ->> 'paymentType' = 'first'
        order by pl.created_at desc
        limit 1
      ) latest_payment_link on true
      left join lateral (
        select soc.*
        from subscription_onboarding_consents soc
        where soc.customer_id = c.id and soc.mode = c.mode
        order by soc.created_at desc
        limit 1
      ) latest_consent on true
      left join lateral (
        select m.*
        from mandates m
        where m.customer_id = c.id and m.mode = c.mode
        order by m.created_at desc
        limit 1
      ) latest_mandate on true
      left join lateral (
        select s.*
        from subscriptions s
        where s.customer_id = c.id and s.mode = c.mode
        order by s.created_at desc
        limit 1
      ) latest_subscription on true
      left join lateral (
        select count(*) as total
        from subscriptions s
        where s.customer_id = c.id and s.mode = c.mode
      ) subscription_counts on true
      where
        (${modeParam}::mollie_mode is null or c.mode = ${modeParam})
        and (
          (${archived}::boolean = true and c.archived_at is not null)
          or (${archived}::boolean = false and c.archived_at is null)
        )
      order by c.created_at desc
    `);

  return result.rows;
});

export async function listCustomers(options?: {
  archived?: boolean;
  mode?: DashboardModeFilter;
}) {
  return listCustomersByMode(options?.mode ?? "all", options?.archived ?? false);
}

export const getCustomerDetail = cache(async (
  customerId: string,
  mode: DashboardModeFilter = "all",
) => {
  const modeParam = toModeParam(mode);
  const [
    customersResult,
    paymentsResult,
    paymentLinksResult,
    mandatesResult,
    subscriptionsResult,
  ] = await Promise.all([
      getDb().execute<CustomerOverview>(sql`
          select
            c.id,
            c.mode,
            c.mollie_customer_id as "mollieCustomerId",
            c.eboekhouden_relation_id as "eboekhoudenRelationId",
            c.eboekhouden_relation_code as "eboekhoudenRelationCode",
            c.eboekhouden_link_status as "eboekhoudenLinkStatus",
            c.eboekhouden_synced_at as "eboekhoudenSyncedAt",
            c.full_name as "fullName",
            ${customerBusinessNameSelect} as "businessName",
            ${customerContactNameSelect} as "contactName",
            c.email,
            nullif(c.metadata ->> 'address', '') as "address",
            c.notes,
            nullif(c.metadata ->> 'phone', '') as "phone",
            c.created_at as "createdAt",
            c.archived_at as "archivedAt",
            latest_payment.id as "latestPaymentId",
            latest_payment.amount_currency as "latestPaymentAmountCurrency",
            latest_payment.amount_value::text as "latestPaymentAmountValue",
            latest_payment.created_at as "latestPaymentCreatedAt",
            latest_payment.paid_at as "latestPaymentPaidAt",
            latest_payment.mollie_status as "latestPaymentStatus",
            latest_payment.payment_type as "latestPaymentType",
            latest_first_payment.id as "latestFirstPaymentId",
            latest_first_payment.checkout_url as "latestFirstPaymentCheckoutUrl",
            latest_first_payment.mollie_status as "latestFirstPaymentStatus",
            latest_first_payment.paid_at as "latestFirstPaymentPaidAt",
            latest_payment_link.id as "latestFirstPaymentLinkId",
            latest_payment_link.checkout_url as "latestFirstPaymentLinkUrl",
            latest_payment_link.mollie_status as "latestFirstPaymentLinkStatus",
            latest_consent.accepted_at as "latestConsentAcceptedAt",
            latest_consent.first_payment_mode as "latestFirstPaymentMode",
            latest_mandate.id as "latestMandateId",
            latest_mandate.mollie_status as "latestMandateStatus",
            coalesce(latest_mandate.is_valid, false) as "hasValidMandate",
            latest_subscription.id as "latestSubscriptionId",
            latest_subscription.amount_currency as "latestSubscriptionAmountCurrency",
            latest_subscription.amount_value::text as "latestSubscriptionAmountValue",
            latest_subscription.description as "latestSubscriptionDescription",
            latest_subscription.interval as "latestSubscriptionInterval",
            latest_subscription.subscription_term_mode as "latestSubscriptionTermMode",
            latest_subscription.total_payments as "latestSubscriptionTotalPayments",
            latest_subscription.last_charge_date::text as "latestSubscriptionLastChargeDate",
            latest_subscription.service_end_at as "latestSubscriptionServiceEndAt",
            latest_subscription.cancellation_effect as "latestSubscriptionCancellationEffect",
            latest_subscription.mollie_status as "latestSubscriptionMollieStatus",
            latest_subscription.metadata ->> 'nextPaymentDate' as "latestSubscriptionNextPaymentDate",
            latest_subscription.start_date::text as "latestSubscriptionStartDate",
            latest_subscription.local_status as "latestSubscriptionStatus",
            latest_subscription.stop_after_current_period as "latestSubscriptionStopAfterCurrentPeriod",
            nullif(
              greatest(
                coalesce(c.last_synced_at, 'epoch'::timestamptz),
                coalesce(latest_payment.last_synced_at, 'epoch'::timestamptz),
                coalesce(latest_first_payment.last_synced_at, 'epoch'::timestamptz),
                coalesce(latest_payment_link.last_synced_at, 'epoch'::timestamptz),
                coalesce(latest_mandate.last_synced_at, 'epoch'::timestamptz),
                coalesce(latest_subscription.last_synced_at, 'epoch'::timestamptz)
              ),
              'epoch'::timestamptz
            ) as "lastSyncedAt",
            coalesce(subscription_counts.total, 0)::int as "subscriptionCount"
          from customers c
          left join lateral (
            select p.*
            from payments p
            where p.customer_id = c.id and p.mode = c.mode
            order by
              coalesce(p.paid_at, p.failed_at, p.created_at) desc,
              p.created_at desc
            limit 1
          ) latest_payment on true
          left join lateral (
            select p.*
            from payments p
            where p.customer_id = c.id and p.mode = c.mode and p.payment_type = 'first'
            order by p.created_at desc
            limit 1
          ) latest_first_payment on true
          left join lateral (
            select pl.*
            from payment_links pl
            where
              pl.customer_id = c.id
              and pl.mode = c.mode
              and pl.metadata ->> 'source' = 'subscription_onboarding'
              and pl.metadata ->> 'paymentType' = 'first'
            order by pl.created_at desc
            limit 1
          ) latest_payment_link on true
          left join lateral (
            select soc.*
            from subscription_onboarding_consents soc
            where soc.customer_id = c.id and soc.mode = c.mode
            order by soc.created_at desc
            limit 1
          ) latest_consent on true
          left join lateral (
            select m.*
            from mandates m
            where m.customer_id = c.id and m.mode = c.mode
            order by m.created_at desc
            limit 1
          ) latest_mandate on true
          left join lateral (
            select s.*
            from subscriptions s
            where s.customer_id = c.id and s.mode = c.mode
            order by s.created_at desc
            limit 1
          ) latest_subscription on true
          left join lateral (
            select count(*) as total
            from subscriptions s
            where s.customer_id = c.id and s.mode = c.mode
          ) subscription_counts on true
          where c.id = ${customerId}
            and (${modeParam}::mollie_mode is null or c.mode = ${modeParam})
          limit 1
        `),
        getDb().execute<PaymentRecord>(sql`
          select
            p.id,
            p.payment_type as "paymentType",
            p.mollie_payment_id as "molliePaymentId",
            p.mollie_status as "mollieStatus",
            p.sequence_type as "sequenceType",
            p.method,
            p.last_synced_at as "lastSyncedAt",
            p.amount_value::text as "amountValue",
            p.amount_currency as "amountCurrency",
            p.checkout_url as "checkoutUrl",
            p.expires_at as "expiresAt",
            p.paid_at as "paidAt",
            p.failed_at as "failedAt",
            p.mandate_id as "mandateId",
            p.created_at as "createdAt"
          from payments p
          where p.customer_id = ${customerId}
            and (${modeParam}::mollie_mode is null or p.mode = ${modeParam})
          order by p.created_at desc
        `),
      getDb().execute<PaymentLinkRecord>(sql`
          select
            pl.id,
            pl.mollie_payment_link_id as "molliePaymentLinkId",
            pl.mollie_status as "mollieStatus",
            pl.description,
            pl.amount_value::text as "amountValue",
            pl.amount_currency as "amountCurrency",
            pl.checkout_url as "checkoutUrl",
            pl.expires_at as "expiresAt",
            pl.metadata,
            pl.last_synced_at as "lastSyncedAt",
            pl.created_at as "createdAt"
          from payment_links pl
          where
            pl.customer_id = ${customerId}
            and (${modeParam}::mollie_mode is null or pl.mode = ${modeParam})
            and pl.metadata ->> 'source' = 'subscription_onboarding'
            and pl.metadata ->> 'paymentType' = 'first'
          order by pl.created_at desc
        `),
      getDb().execute<MandateRecord>(sql`
          select
            m.id,
            m.mollie_mandate_id as "mollieMandateId",
            m.method,
            m.mollie_status as "mollieStatus",
            m.is_valid as "isValid",
            m.details,
            m.created_at as "createdAt"
          from mandates m
          where m.customer_id = ${customerId}
            and (${modeParam}::mollie_mode is null or m.mode = ${modeParam})
          order by m.created_at desc
        `),
      getDb().execute<SubscriptionRecord>(sql`
          select
            s.id,
            s.description,
            s.interval,
            s.amount_value::text as "amountValue",
            s.amount_currency as "amountCurrency",
            s.local_status as "localStatus",
            s.mollie_status as "mollieStatus",
            s.subscription_term_mode as "subscriptionTermMode",
            s.total_payments as "totalPayments",
            s.last_charge_date::text as "lastChargeDate",
            s.service_end_at as "serviceEndAt",
            s.cancellation_effect as "cancellationEffect",
            s.start_date::text as "startDate",
            s.canceled_at as "canceledAt",
            s.billing_day as "billingDay",
            s.mandate_id as "mandateId",
            s.stop_after_current_period as "stopAfterCurrentPeriod",
            s.last_synced_at as "lastSyncedAt",
            s.metadata ->> 'nextPaymentDate' as "nextPaymentDate",
            s.created_at as "createdAt"
          from subscriptions s
          where s.customer_id = ${customerId}
            and (${modeParam}::mollie_mode is null or s.mode = ${modeParam})
          order by s.created_at desc
        `),
    ]);

  const customer = customersResult.rows[0];

  if (!customer) {
    return null;
  }

  return {
    customer,
    mandates: mandatesResult.rows.map((mandate) => ({
      ...mandate,
      details:
        typeof mandate.details === "object" && mandate.details !== null
          ? mandate.details
          : {},
    })),
    paymentLinks: paymentLinksResult.rows.map((paymentLink) => ({
      ...paymentLink,
      metadata:
        typeof paymentLink.metadata === "object" && paymentLink.metadata !== null
          ? paymentLink.metadata
          : {},
    })),
    payments: paymentsResult.rows,
    subscriptions: subscriptionsResult.rows,
  } satisfies CustomerDetail;
});

export async function getLatestConsentLinkUrl(
  customerId: string,
  mode: DashboardModeFilter = "all",
) {
  const modeParam = toModeParam(mode);
  const result = await getDb().execute<{
    consentId: string;
    consentToken: string | null;
    consentTokenCiphertext: string | null;
    consentTokenHash: string | null;
  }>(sql`
      select
        soc.id as "consentId",
        soc.consent_token as "consentToken",
        soc.consent_token_ciphertext as "consentTokenCiphertext",
        soc.consent_token_hash as "consentTokenHash"
      from subscription_onboarding_consents soc
      where soc.customer_id = ${customerId}
        and (${modeParam}::mollie_mode is null or soc.mode = ${modeParam})
      order by soc.created_at desc
      limit 1
    `);

  const latestConsent = result.rows[0];

  if (!latestConsent) {
    return null;
  }

  const consentToken = resolveStoredConsentToken(latestConsent);

  if (!consentToken) {
    return null;
  }

  if (
    latestConsent.consentToken ||
    !latestConsent.consentTokenHash ||
    !latestConsent.consentTokenCiphertext
  ) {
    const storage = buildConsentTokenStorage(consentToken);

    await getDb().execute(sql`
      update subscription_onboarding_consents
      set
        consent_token = null,
        consent_token_hash = ${storage.consentTokenHash},
        consent_token_ciphertext = ${storage.consentTokenCiphertext},
        updated_at = now()
      where id = ${latestConsent.consentId}
        and (
          consent_token is not null
          or consent_token_hash is null
          or consent_token_ciphertext is null
        )
    `);
  }

  return buildConsentLinkUrl(consentToken, env.APP_URL);
}

const listSubscriptionsByMode = cache(async (mode: DashboardModeFilter) => {
  const modeParam = toModeParam(mode);
  const result = await getDb().execute<SubscriptionOverview>(sql`
      select
        s.id,
        s.description,
        s.interval,
        s.amount_value::text as "amountValue",
        s.amount_currency as "amountCurrency",
        s.local_status as "localStatus",
        s.mollie_status as "mollieStatus",
        s.subscription_term_mode as "subscriptionTermMode",
        s.total_payments as "totalPayments",
        s.last_charge_date::text as "lastChargeDate",
        s.service_end_at as "serviceEndAt",
        s.cancellation_effect as "cancellationEffect",
        s.start_date::text as "startDate",
        s.canceled_at as "canceledAt",
        s.stop_after_current_period as "stopAfterCurrentPeriod",
        s.metadata ->> 'nextPaymentDate' as "nextPaymentDate",
        s.created_at as "createdAt",
        s.mandate_id as "mandateId",
        s.mode,
        s.mollie_subscription_id as "mollieSubscriptionId",
        c.id as "customerId",
        coalesce(nullif(c.metadata ->> 'businessName', ''), c.full_name) as "customerName",
        c.email as "customerEmail"
      from subscriptions s
      inner join customers c on c.id = s.customer_id and c.mode = s.mode
      where (${modeParam}::mollie_mode is null or s.mode = ${modeParam})
      order by s.created_at desc
    `);

  return result.rows;
});

export async function listSubscriptions(options?: {
  mode?: DashboardModeFilter;
}) {
  return listSubscriptionsByMode(options?.mode ?? "all");
}

const listPaymentsByMode = cache(async (mode: DashboardModeFilter) => {
  const modeParam = toModeParam(mode);
  const result = await getDb().execute<PaymentOverview>(sql`
      select
        p.id,
        p.mode,
        p.payment_type as "paymentType",
        p.mollie_payment_id as "molliePaymentId",
        p.mollie_status as "mollieStatus",
        p.sequence_type as "sequenceType",
        p.method,
        p.last_synced_at as "lastSyncedAt",
        p.amount_value::text as "amountValue",
        p.amount_currency as "amountCurrency",
        p.checkout_url as "checkoutUrl",
        p.paid_at as "paidAt",
        p.failed_at as "failedAt",
        p.created_at as "createdAt",
        p.mandate_id as "mandateId",
        c.id as "customerId",
        coalesce(nullif(c.metadata ->> 'businessName', ''), c.full_name) as "customerName",
        c.email as "customerEmail",
        s.id as "subscriptionId",
        s.description as "subscriptionDescription"
      from payments p
      left join customers c on c.id = p.customer_id and c.mode = p.mode
      left join subscriptions s on s.id = p.subscription_id and s.mode = p.mode
      where (${modeParam}::mollie_mode is null or p.mode = ${modeParam})
      order by
        coalesce(p.paid_at, p.failed_at, p.created_at) desc,
        p.created_at desc
    `);

  return result.rows;
});

export async function listPayments(options?: {
  mode?: DashboardModeFilter;
}) {
  return listPaymentsByMode(options?.mode ?? "all");
}

const listOperationalAlertsByMode = cache(async (mode: DashboardModeFilter) => {
  const modeParam = toModeParam(mode);
  const result = await getDb().execute<OperationalAlert>(sql`
    select
      p.id,
      'payment' as "type",
      case
        when p.disputed_at is not null
          or p.recurring_collection_state in ('mandate_problem_review', 'reversal_critical_review')
          then 'critical'
        else 'warning'
      end as "severity",
      case
        when p.disputed_at is not null
          or p.recurring_collection_state = 'reversal_critical_review'
          then 'Payment reversed or disputed'
        when p.recurring_collection_state = 'mandate_problem_review'
          then 'Mandate problem'
        when p.recurring_collection_state = 'failed_needs_review'
          then 'Recurring payment needs review'
        when p.mollie_status = 'failed' then 'Failed payment'
        when p.mollie_status = 'expired' then 'Expired payment'
        else 'Payment needs attention'
      end as "title",
      case
        when p.disputed_at is not null
          or p.recurring_collection_state = 'reversal_critical_review'
          then 'A payment was reversed or disputed. The invoice obligation may still be open. Review Mollie and e-Boekhouden before changing service or billing state.'
        when p.recurring_collection_state = 'mandate_problem_review'
          then 'A recurring payment failed with a possible mandate or bank-account problem. Review the payment path before relying on future automatic collection.'
        when p.recurring_collection_state = 'failed_needs_review'
          then 'A recurring payment failed or stayed pending beyond the safe processing window. Keep the existing invoice open and review manually before retrying.'
        when p.mollie_status = 'failed' then 'A payment failed and should be reviewed before service continues.'
        when p.mollie_status = 'expired' then 'A checkout expired before the customer completed payment.'
        else 'The payment status is outside the happy path.'
      end as "summary",
      coalesce(p.disputed_at, p.failed_at, p.created_at) as "createdAt",
      c.id as "customerId",
      coalesce(nullif(c.metadata ->> 'businessName', ''), c.full_name) as "customerName",
      c.email as "customerEmail",
      concat('/payments?focus=', p.id) as "href"
    from payments p
    left join customers c on c.id = p.customer_id
    where
      (${modeParam}::mollie_mode is null or p.mode = ${modeParam})
      and (
        p.disputed_at is not null
        or p.mollie_status in ('failed', 'expired')
        or p.recurring_collection_state in (
          'failed_needs_review',
          'mandate_problem_review',
          'reversal_critical_review'
        )
      )

    union all

    select
      s.id,
      'subscription' as "type",
      case
        when s.local_status = 'out_of_sync' then 'critical'
        else 'warning'
      end as "severity",
      case
        when s.local_status = 'out_of_sync' then 'Subscription out of sync'
        else 'Subscription needs payment action'
      end as "title",
      case
        when s.local_status = 'out_of_sync' then 'The local subscription state no longer matches the latest Mollie state.'
        else 'The subscription is suspended or waiting on a payment-related intervention.'
      end as "summary",
      s.updated_at as "createdAt",
      c.id as "customerId",
      coalesce(nullif(c.metadata ->> 'businessName', ''), c.full_name) as "customerName",
      c.email as "customerEmail",
      concat('/customers?focus=', c.id) as "href"
    from subscriptions s
    inner join customers c on c.id = s.customer_id
    where
      (${modeParam}::mollie_mode is null or s.mode = ${modeParam})
      and s.local_status in ('payment_action_required', 'out_of_sync')

    order by "createdAt" desc
  `);

  return result.rows;
});

export async function listOperationalAlerts(options?: {
  mode?: DashboardModeFilter;
}) {
  return listOperationalAlertsByMode(options?.mode ?? "all");
}
