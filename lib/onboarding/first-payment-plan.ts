import {
  buildConsentPlanSnapshot,
  type BillingInterval,
  type ConsentPlanSnapshot,
  type FirstPaymentMode,
  type SubscriptionTermMode,
  type TenantSubscriptionPolicyDefaults,
} from "@/lib/subscription-policy";

export type FirstPaymentPlanInput = {
  firstPaymentMode: FirstPaymentMode;
  serviceEndAt?: string;
  subscriptionAmountValue: string;
  subscriptionDescription: string;
  subscriptionInterval: BillingInterval;
  subscriptionStartDate: string;
  subscriptionTermMode: SubscriptionTermMode;
  tenantPolicy: TenantSubscriptionPolicyDefaults;
  totalPayments: number | null;
};

export type FirstPaymentPlan = {
  amountValue: string;
  paymentDescription: string;
  planSnapshot: ConsentPlanSnapshot;
};

export function normalizeSubscriptionAmountValue(value: string) {
  const normalized = value.replace(",", ".").trim();

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Enter a valid amount using up to two decimals.");
  }

  return Number(normalized).toFixed(2);
}

export function normalizeDateInput(value: string, label: string) {
  const normalized = value.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`${label} must use YYYY-MM-DD.`);
  }

  const parsed = new Date(`${normalized}T00:00:00Z`);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${label} is not a valid date.`);
  }

  return normalized;
}

export function normalizeOptionalServiceEndDate(value: string | undefined) {
  if (!value || value.trim().length === 0) {
    return null;
  }

  return normalizeDateInput(value, "Service end date");
}

export function validateFirstPaymentTermInput(input: {
  firstPaymentMode: FirstPaymentMode;
  subscriptionTermMode: SubscriptionTermMode;
  totalPayments: number | null;
}) {
  if (input.subscriptionTermMode === "open_ended") {
    if (input.totalPayments !== null) {
      throw new Error("Total payments must be empty for open-ended subscriptions.");
    }

    return;
  }

  if (input.totalPayments === null) {
    throw new Error("Total payments is required for fixed-term subscriptions.");
  }

  if (input.firstPaymentMode === "real_installment" && input.totalPayments < 2) {
    throw new Error("Fixed-term subscriptions with a real first installment require at least 2 total payments.");
  }

  if (input.firstPaymentMode === "mandate_only" && input.totalPayments < 1) {
    throw new Error("Fixed-term subscriptions with a mandate-only first payment require at least 1 total payment.");
  }
}

export function buildFirstPaymentPlan(
  input: FirstPaymentPlanInput,
): FirstPaymentPlan {
  const subscriptionAmountValue = normalizeSubscriptionAmountValue(
    input.subscriptionAmountValue,
  );
  const subscriptionStartDate = normalizeDateInput(
    input.subscriptionStartDate,
    "Subscription start date",
  );
  const serviceEndAt = normalizeOptionalServiceEndDate(input.serviceEndAt);
  const totalPayments =
    input.subscriptionTermMode === "fixed_term" ? input.totalPayments : null;

  validateFirstPaymentTermInput({
    firstPaymentMode: input.firstPaymentMode,
    subscriptionTermMode: input.subscriptionTermMode,
    totalPayments,
  });

  const planSnapshot = buildConsentPlanSnapshot({
    billingInterval: input.subscriptionInterval,
    cancellationEffect: input.tenantPolicy.defaultCancellationEffect,
    cancellationEmail: input.tenantPolicy.cancellationEmail,
    description: input.subscriptionDescription,
    explicitServiceEndAt: serviceEndAt,
    firstPaymentMode: input.firstPaymentMode,
    startDate: subscriptionStartDate,
    subscriptionAmountValue,
    subscriptionTermMode: input.subscriptionTermMode,
    tenantPolicy: input.tenantPolicy,
    totalPayments,
  });

  return {
    amountValue: planSnapshot.firstPaymentAmountValue,
    paymentDescription:
      input.firstPaymentMode === "mandate_only"
        ? "Mandate setup payment"
        : input.subscriptionDescription,
    planSnapshot,
  };
}
