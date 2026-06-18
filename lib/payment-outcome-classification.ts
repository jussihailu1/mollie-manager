export type PaymentFlowKind =
  | "first_payment"
  | "mandate_only"
  | "manual"
  | "recurring";

export type PaymentOutcomeState =
  | "charged_back"
  | "failed"
  | "mandate_problem"
  | "needs_review"
  | "paid"
  | "pending"
  | "reversed";

export type PaymentOutcomeReason =
  | "chargeback_detected"
  | "definitive_failed_status"
  | "long_pending_window_elapsed"
  | "mandate_setup_failed"
  | "missing_or_unusable_mandate"
  | "paid"
  | "pending_within_safe_window"
  | "refund_or_reversal_detected"
  | "status_reason_indicates_mandate_problem"
  | "unknown_status";

export type PaymentOutcomeClassification = {
  customerNotificationAllowed: boolean;
  operatorTaskRequired: boolean;
  reason: PaymentOutcomeReason;
  safePendingWindowEndsAt: string | null;
  state: PaymentOutcomeState;
};

export type ClassifyPaymentOutcomeInput = {
  createdAt?: string | null;
  flowKind: PaymentFlowKind;
  hasChargeback?: boolean;
  hasRefundOrReversal?: boolean;
  hasUsableMandate?: boolean | null;
  now?: string | Date;
  safePendingWindowDays?: number;
  status: string | null | undefined;
  statusReason?: string | null;
};

const mandateProblemReasonFragments = [
  "account closed",
  "blocked",
  "direct debit blocked",
  "invalid account",
  "invalid bank",
  "invalid iban",
  "mandate",
  "no valid mandate",
  "refused by bank",
];

const definitiveFailedStatuses = new Set(["canceled", "expired", "failed"]);
const pendingStatuses = new Set(["open", "pending"]);
const paidStatuses = new Set(["authorized", "paid"]);

function addUtcDays(value: Date, days: number) {
  const date = new Date(value.getTime());
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function parseDateTime(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hasMandateProblemReason(statusReason: string | null | undefined) {
  const normalizedReason = (statusReason ?? "").toLowerCase();
  return mandateProblemReasonFragments.some((fragment) =>
    normalizedReason.includes(fragment),
  );
}

function buildOutcome(
  state: PaymentOutcomeState,
  reason: PaymentOutcomeReason,
  safePendingWindowEndsAt: string | null = null,
): PaymentOutcomeClassification {
  const isReviewState =
    state === "charged_back" ||
    state === "failed" ||
    state === "mandate_problem" ||
    state === "needs_review" ||
    state === "reversed";

  return {
    customerNotificationAllowed: isReviewState,
    operatorTaskRequired: isReviewState,
    reason,
    safePendingWindowEndsAt,
    state,
  };
}

export function classifyPaymentOutcome(
  input: ClassifyPaymentOutcomeInput,
): PaymentOutcomeClassification {
  const normalizedStatus = (input.status ?? "").toLowerCase();

  if (input.hasChargeback || normalizedStatus === "charged_back") {
    return buildOutcome("charged_back", "chargeback_detected");
  }

  if (
    input.hasRefundOrReversal ||
    normalizedStatus === "refunded" ||
    normalizedStatus === "reversed"
  ) {
    return buildOutcome("reversed", "refund_or_reversal_detected");
  }

  if (
    (input.flowKind === "recurring" || input.flowKind === "mandate_only") &&
    input.hasUsableMandate === false
  ) {
    return buildOutcome("mandate_problem", "missing_or_unusable_mandate");
  }

  if (paidStatuses.has(normalizedStatus)) {
    return buildOutcome("paid", "paid");
  }

  if (pendingStatuses.has(normalizedStatus)) {
    const pendingWindowDays = input.safePendingWindowDays ?? 5;
    const createdAt = parseDateTime(input.createdAt);
    const windowEndsAt = createdAt ? addUtcDays(createdAt, pendingWindowDays) : null;
    const windowEndsAtIso = windowEndsAt?.toISOString() ?? null;
    const now = parseDateTime(input.now ?? new Date());

    if (windowEndsAt && now && now.getTime() > windowEndsAt.getTime()) {
      return buildOutcome(
        "needs_review",
        "long_pending_window_elapsed",
        windowEndsAtIso,
      );
    }

    return buildOutcome(
      "pending",
      "pending_within_safe_window",
      windowEndsAtIso,
    );
  }

  if (definitiveFailedStatuses.has(normalizedStatus)) {
    if (input.flowKind === "mandate_only") {
      return buildOutcome("mandate_problem", "mandate_setup_failed");
    }

    if (hasMandateProblemReason(input.statusReason)) {
      return buildOutcome(
        "mandate_problem",
        "status_reason_indicates_mandate_problem",
      );
    }

    return buildOutcome("failed", "definitive_failed_status");
  }

  return buildOutcome("needs_review", "unknown_status");
}

