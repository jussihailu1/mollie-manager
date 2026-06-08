import {
  buildRecurringBillingConsentSnapshot,
  type RecurringBillingConsentSnapshot,
} from "@/lib/recurring-billing-policy";

export type BillingInterval = "weekly" | "monthly" | "yearly";
export type SubscriptionTermMode = "open_ended" | "fixed_term";
export type CancellationEffect = "immediate" | "end_of_paid_period";
export type FirstPaymentMode = "real_installment" | "mandate_only";

export const REQUIRED_CONSENT_CHECKBOX_KEYS = [
  "recurring_terms_ack",
  "recurring_billing_policy_ack",
  "cancellation_policy_ack",
] as const;

export type RequiredConsentCheckboxKey =
  (typeof REQUIRED_CONSENT_CHECKBOX_KEYS)[number];

export type TenantSubscriptionPolicyDefaults = {
  cancellationEmail: string;
  defaultCancellationEffect: CancellationEffect;
  privacyUrl: string;
  termsUrl: string;
  termsVersion: string;
};

export type ConsentPlanSnapshot = {
  amountCurrency: "EUR";
  billingInterval: BillingInterval;
  cancellationEffect: CancellationEffect;
  cancellationEmail: string;
  cancellationMethod: "email";
  description: string;
  finalChargeDate: string | null;
  firstPaymentAmountValue: string;
  firstPaymentMode: FirstPaymentMode;
  recurringBilling: RecurringBillingConsentSnapshot;
  recurringChargeCount: number | null;
  serviceEndAt: string | null;
  startDate: string;
  subscriptionAmountValue: string;
  subscriptionTermMode: SubscriptionTermMode;
  termsPrivacy: {
    privacyUrl: string;
    termsUrl: string;
    termsVersion: string;
  };
  totalPayments: number | null;
};

function parseDate(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function toDateString(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addInterval(value: Date, interval: BillingInterval) {
  const next = new Date(value);

  if (interval === "weekly") {
    next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }

  if (interval === "monthly") {
    next.setUTCMonth(next.getUTCMonth() + 1);
    return next;
  }

  next.setUTCFullYear(next.getUTCFullYear() + 1);
  return next;
}

function addIntervals(startDate: string, interval: BillingInterval, count: number) {
  let current = parseDate(startDate);

  for (let i = 0; i < count; i += 1) {
    current = addInterval(current, interval);
  }

  return current;
}

export function toMollieInterval(interval: BillingInterval) {
  if (interval === "weekly") {
    return "1 week";
  }

  if (interval === "monthly") {
    return "1 month";
  }

  return "12 months";
}

export function deriveRecurringChargeCount(input: {
  firstPaymentMode: FirstPaymentMode;
  subscriptionTermMode: SubscriptionTermMode;
  totalPayments: number | null;
}) {
  if (input.subscriptionTermMode === "open_ended") {
    return null;
  }

  if (input.totalPayments === null) {
    return null;
  }

  if (input.firstPaymentMode === "real_installment") {
    return Math.max(input.totalPayments - 1, 0);
  }

  return input.totalPayments;
}

export function deriveFinalChargeDate(input: {
  firstPaymentMode: FirstPaymentMode;
  interval: BillingInterval;
  startDate: string;
  subscriptionTermMode: SubscriptionTermMode;
  totalPayments: number | null;
}) {
  const recurringChargeCount = deriveRecurringChargeCount({
    firstPaymentMode: input.firstPaymentMode,
    subscriptionTermMode: input.subscriptionTermMode,
    totalPayments: input.totalPayments,
  });

  if (recurringChargeCount === null || recurringChargeCount < 1) {
    return null;
  }

  const offset = recurringChargeCount - 1;
  const finalChargeDate = addIntervals(input.startDate, input.interval, offset);

  return toDateString(finalChargeDate);
}

export function deriveServiceEndAt(input: {
  explicitServiceEndAt?: string | null;
  finalChargeDate: string | null;
  interval: BillingInterval;
  subscriptionTermMode: SubscriptionTermMode;
}) {
  if (input.explicitServiceEndAt) {
    return `${input.explicitServiceEndAt}T00:00:00.000Z`;
  }

  if (input.subscriptionTermMode !== "fixed_term" || !input.finalChargeDate) {
    return null;
  }

  const endDate = addInterval(parseDate(input.finalChargeDate), input.interval);
  return `${toDateString(endDate)}T00:00:00.000Z`;
}

export function buildConsentPlanSnapshot(input: {
  billingInterval: BillingInterval;
  cancellationEffect: CancellationEffect;
  cancellationEmail: string;
  description: string;
  explicitServiceEndAt?: string | null;
  firstPaymentMode: FirstPaymentMode;
  startDate: string;
  subscriptionAmountValue: string;
  subscriptionTermMode: SubscriptionTermMode;
  tenantPolicy: TenantSubscriptionPolicyDefaults;
  totalPayments: number | null;
}) {
  const finalChargeDate = deriveFinalChargeDate({
    firstPaymentMode: input.firstPaymentMode,
    interval: input.billingInterval,
    startDate: input.startDate,
    subscriptionTermMode: input.subscriptionTermMode,
    totalPayments: input.totalPayments,
  });
  const recurringChargeCount = deriveRecurringChargeCount({
    firstPaymentMode: input.firstPaymentMode,
    subscriptionTermMode: input.subscriptionTermMode,
    totalPayments: input.totalPayments,
  });
  const firstPaymentAmountValue =
    input.firstPaymentMode === "mandate_only" ? "0.01" : input.subscriptionAmountValue;

  return {
    amountCurrency: "EUR",
    billingInterval: input.billingInterval,
    cancellationEffect: input.cancellationEffect,
    cancellationEmail: input.cancellationEmail,
    cancellationMethod: "email",
    description: input.description,
    finalChargeDate,
    firstPaymentAmountValue,
    firstPaymentMode: input.firstPaymentMode,
    recurringBilling: buildRecurringBillingConsentSnapshot({
      firstPaymentMode: input.firstPaymentMode,
    }),
    recurringChargeCount,
    serviceEndAt: deriveServiceEndAt({
      explicitServiceEndAt: input.explicitServiceEndAt,
      finalChargeDate,
      interval: input.billingInterval,
      subscriptionTermMode: input.subscriptionTermMode,
    }),
    startDate: input.startDate,
    subscriptionAmountValue: input.subscriptionAmountValue,
    subscriptionTermMode: input.subscriptionTermMode,
    termsPrivacy: {
      privacyUrl: input.tenantPolicy.privacyUrl,
      termsUrl: input.tenantPolicy.termsUrl,
      termsVersion: input.tenantPolicy.termsVersion,
    },
    totalPayments: input.subscriptionTermMode === "fixed_term" ? input.totalPayments : null,
  } satisfies ConsentPlanSnapshot;
}

