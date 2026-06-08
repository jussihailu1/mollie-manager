import {
  classifyRecurringCollection,
  DEFAULT_RECURRING_BILLING_POLICY,
  isCollectionReviewState,
  type RecurringCollectionState,
} from "@/lib/recurring-billing-policy";

type PaymentStatusReason =
  | string
  | {
      code?: string;
      message?: string;
    }
  | null
  | undefined;

export type PaymentSyncSource = {
  amountChargedBack?: {
    value: string;
  } | null;
  description?: string;
  redirectUrl?: string | null;
  sequenceType?: string | null;
  status: string;
  statusReason?: PaymentStatusReason;
  subscriptionId?: string | null;
};

export type PaymentSyncType = "first" | "manual" | "recurring";

export function resolvePaymentSyncType(payment: PaymentSyncSource): PaymentSyncType {
  if (payment.subscriptionId || payment.sequenceType === "recurring") {
    return "recurring";
  }

  if (payment.sequenceType === "first") {
    return "first";
  }

  return "manual";
}

export function hasPaymentChargeback(payment: PaymentSyncSource) {
  return Boolean(
    payment.amountChargedBack && payment.amountChargedBack.value !== "0.00",
  );
}

export function serializePaymentStatusReason(
  statusReason: PaymentStatusReason,
) {
  if (!statusReason) {
    return null;
  }

  if (typeof statusReason === "string") {
    return statusReason;
  }

  return [statusReason.code, statusReason.message].filter(Boolean).join(": ");
}

export function derivePaymentRecurringCollectionState(
  payment: PaymentSyncSource,
) {
  return classifyRecurringCollection({
    hasChargeback: hasPaymentChargeback(payment),
    paymentType: resolvePaymentSyncType(payment),
    status: payment.status,
    statusReason: serializePaymentStatusReason(payment.statusReason),
  });
}

export function deriveCollectionReviewRequiredAt(
  state: RecurringCollectionState,
  nowIso = new Date().toISOString(),
) {
  return isCollectionReviewState(state) ? nowIso : null;
}

export function resolveFirstPaymentMode(metadata: Record<string, unknown>) {
  return metadata.firstPaymentMode === "mandate_only"
    ? "mandate_only"
    : "real_installment";
}

export function buildPaymentSyncMetadata(input: {
  payment: PaymentSyncSource;
  paymentType: PaymentSyncType;
}) {
  return {
    description: input.payment.description,
    recurringBillingPolicy:
      input.paymentType === "recurring"
        ? {
            sepaPendingReturnWindowDays:
              DEFAULT_RECURRING_BILLING_POLICY.sepaPendingReturnWindowDays,
          }
        : null,
    redirectUrl: input.payment.redirectUrl ?? null,
    statusReason: serializePaymentStatusReason(input.payment.statusReason),
  };
}
