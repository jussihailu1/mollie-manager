import type {
  CancellationEffect,
  SubscriptionTermMode,
} from "@/lib/subscription-policy";

export type SubscriptionOperation = "cancel" | "pause" | "resume";

export type LocalSubscriptionStatus =
  | "draft"
  | "awaiting_first_payment"
  | "mandate_pending"
  | "active"
  | "payment_action_required"
  | "future_charges_stopped"
  | "charged_back"
  | "out_of_sync"
  | "cancelled";

export type ProviderSubscriptionStatus =
  | "pending"
  | "active"
  | "suspended"
  | "canceled"
  | "completed";

export type SubscriptionOperationReasonCode =
  | "operation_allowed"
  | "provider_operation_unsupported"
  | "fixed_term_policy_undefined"
  | "terminal_state"
  | "operator_reason_required"
  | "invalid_effective_date"
  | "effective_date_before_as_of"
  | "subscription_not_active"
  | "paid_period_end_required"
  | "paid_period_end_before_effective_date";

export type SubscriptionOperationPolicyInput = {
  asOf: string;
  cancellationEffect: CancellationEffect;
  localStatus: LocalSubscriptionStatus;
  operation: SubscriptionOperation;
  operatorReason: string;
  paidPeriodEndAt: string | null;
  providerStatus: ProviderSubscriptionStatus;
  requestedEffectiveAt: string;
  serviceEndAt: string | null;
  termMode: SubscriptionTermMode;
};

export type SubscriptionOperationPolicyDecision = {
  allowed: boolean;
  billingEffect:
    | { kind: "none"; effectiveAt: null }
    | { kind: "stop_future_provider_charges"; effectiveAt: string };
  existingCollectionStateEffect: "preserve_existing_invoice_and_payment_collection_state";
  providerMutationRequirement:
    | "none"
    | "cancel_provider_subscription_now"
    | "schedule_provider_cancellation";
  reasonCode: SubscriptionOperationReasonCode;
  serviceEffect:
    | { kind: "none"; serviceEndAt: null }
    | {
        kind: "end_at_requested_effective_at" | "preserve_until_paid_period_end";
        serviceEndAt: string;
      };
};

const COLLECTION_STATE_PRESERVATION =
  "preserve_existing_invoice_and_payment_collection_state" as const;

const terminalLocalStatuses = new Set<LocalSubscriptionStatus>([
  "future_charges_stopped",
  "cancelled",
]);

const terminalProviderStatuses = new Set<ProviderSubscriptionStatus>([
  "canceled",
  "completed",
]);

function deny(
  reasonCode: Exclude<SubscriptionOperationReasonCode, "operation_allowed">,
): SubscriptionOperationPolicyDecision {
  return {
    allowed: false,
    billingEffect: { kind: "none", effectiveAt: null },
    existingCollectionStateEffect: COLLECTION_STATE_PRESERVATION,
    providerMutationRequirement: "none",
    reasonCode,
    serviceEffect: { kind: "none", serviceEndAt: null },
  };
}

function parseTimestamp(value: string | null) {
  if (
    !value ||
    value.trim() !== value ||
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(value)
  ) {
    return null;
  }

  const timestamp = Date.parse(value);

  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value.slice(0, 10)
  ) {
    return null;
  }

  return timestamp;
}

export function decideSubscriptionOperation(
  input: SubscriptionOperationPolicyInput,
): SubscriptionOperationPolicyDecision {
  if (input.operation === "pause" || input.operation === "resume") {
    return deny("provider_operation_unsupported");
  }

  if (
    terminalLocalStatuses.has(input.localStatus) ||
    terminalProviderStatuses.has(input.providerStatus)
  ) {
    return deny("terminal_state");
  }

  if (input.termMode === "fixed_term") {
    return deny("fixed_term_policy_undefined");
  }

  if (input.serviceEndAt !== null) {
    return deny("terminal_state");
  }

  if (input.operatorReason.trim().length === 0) {
    return deny("operator_reason_required");
  }

  const requestedEffectiveAt = parseTimestamp(input.requestedEffectiveAt);
  const asOf = parseTimestamp(input.asOf);

  if (requestedEffectiveAt === null || asOf === null) {
    return deny("invalid_effective_date");
  }

  if (requestedEffectiveAt < asOf) {
    return deny("effective_date_before_as_of");
  }

  if (input.localStatus !== "active" || input.providerStatus !== "active") {
    return deny("subscription_not_active");
  }

  if (input.cancellationEffect === "end_of_paid_period") {
    const paidPeriodEndAt = parseTimestamp(input.paidPeriodEndAt);

    if (paidPeriodEndAt === null) {
      return deny("paid_period_end_required");
    }

    if (paidPeriodEndAt < requestedEffectiveAt) {
      return deny("paid_period_end_before_effective_date");
    }

    return {
      allowed: true,
      billingEffect: {
        kind: "stop_future_provider_charges",
        effectiveAt: input.requestedEffectiveAt,
      },
      existingCollectionStateEffect: COLLECTION_STATE_PRESERVATION,
      providerMutationRequirement:
        requestedEffectiveAt === asOf
          ? "cancel_provider_subscription_now"
          : "schedule_provider_cancellation",
      reasonCode: "operation_allowed",
      serviceEffect: {
        kind: "preserve_until_paid_period_end",
        serviceEndAt: input.paidPeriodEndAt as string,
      },
    };
  }

  return {
    allowed: true,
    billingEffect: {
      kind: "stop_future_provider_charges",
      effectiveAt: input.requestedEffectiveAt,
    },
    existingCollectionStateEffect: COLLECTION_STATE_PRESERVATION,
    providerMutationRequirement:
      requestedEffectiveAt === asOf
        ? "cancel_provider_subscription_now"
        : "schedule_provider_cancellation",
    reasonCode: "operation_allowed",
    serviceEffect: {
      kind: "end_at_requested_effective_at",
      serviceEndAt: input.requestedEffectiveAt,
    },
  };
}
