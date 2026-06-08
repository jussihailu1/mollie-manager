export const DEFAULT_RECURRING_BILLING_POLICY = {
  invoiceNoticeDaysBeforeDueDate: 5,
  invoicePreNotificationMethod: "invoice_email",
  sepaPendingReturnWindowDays: 5,
} as const;

export type RecurringBillingConsentSnapshot = {
  automaticCollectionOnPlannedDate: true;
  invoiceNoticeDaysBeforeDueDate: number;
  invoicePreNotificationMethod: "invoice_email";
  invoiceSentBeforeAutomaticCollection: true;
  mandateOnlySetupPaymentExcludedFromRecurringInvoice: boolean;
  sepaDirectDebitCanFailOrBeReversed: true;
  sepaPendingReturnWindowDays: number;
  shorterSepaPreNotificationAgreed: true;
};

export type RecurringCollectionState =
  | "not_applicable"
  | "settled"
  | "pending_return_window"
  | "failed_needs_review"
  | "mandate_problem_review"
  | "reversal_critical_review";

export type RecurringBillingInvoiceState =
  | "pending_invoice"
  | "invoice_creating"
  | "invoice_created"
  | "invoice_sent"
  | "invoice_failed"
  | "skipped"
  | "canceled";

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

export function buildRecurringBillingConsentSnapshot(input: {
  firstPaymentMode: "real_installment" | "mandate_only";
}): RecurringBillingConsentSnapshot {
  return {
    automaticCollectionOnPlannedDate: true,
    invoiceNoticeDaysBeforeDueDate:
      DEFAULT_RECURRING_BILLING_POLICY.invoiceNoticeDaysBeforeDueDate,
    invoicePreNotificationMethod:
      DEFAULT_RECURRING_BILLING_POLICY.invoicePreNotificationMethod,
    invoiceSentBeforeAutomaticCollection: true,
    mandateOnlySetupPaymentExcludedFromRecurringInvoice:
      input.firstPaymentMode === "mandate_only",
    sepaDirectDebitCanFailOrBeReversed: true,
    sepaPendingReturnWindowDays:
      DEFAULT_RECURRING_BILLING_POLICY.sepaPendingReturnWindowDays,
    shorterSepaPreNotificationAgreed: true,
  };
}

function parseDate(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00Z`);
}

function toDateString(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function addCalendarDays(value: string, days: number) {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateString(date);
}

export function deriveInvoiceSendDueDate(input: {
  invoiceNoticeDaysBeforeDueDate?: number;
  plannedCollectionDate: string;
}) {
  return addCalendarDays(
    input.plannedCollectionDate,
    -(input.invoiceNoticeDaysBeforeDueDate ??
      DEFAULT_RECURRING_BILLING_POLICY.invoiceNoticeDaysBeforeDueDate),
  );
}

export function addRecurringBillingInterval(value: string, interval: string) {
  const date = parseDate(value);
  const normalizedInterval = interval.trim().toLowerCase();

  if (normalizedInterval === "1 week" || normalizedInterval === "weekly") {
    date.setUTCDate(date.getUTCDate() + 7);
    return toDateString(date);
  }

  if (normalizedInterval === "1 month" || normalizedInterval === "monthly") {
    date.setUTCMonth(date.getUTCMonth() + 1);
    return toDateString(date);
  }

  if (
    normalizedInterval === "12 months" ||
    normalizedInterval === "1 year" ||
    normalizedInterval === "yearly"
  ) {
    date.setUTCFullYear(date.getUTCFullYear() + 1);
    return toDateString(date);
  }

  throw new Error(`Unsupported recurring billing interval: ${interval}`);
}

export function isCollectionReviewState(state: RecurringCollectionState) {
  return (
    state === "failed_needs_review" ||
    state === "mandate_problem_review" ||
    state === "reversal_critical_review"
  );
}

export function classifyRecurringCollection(input: {
  hasChargeback: boolean;
  paymentType: "first" | "manual" | "recurring" | "refund";
  status: string | null | undefined;
  statusReason?: string | null;
}): RecurringCollectionState {
  if (input.paymentType !== "recurring") {
    return "not_applicable";
  }

  if (input.hasChargeback) {
    return "reversal_critical_review";
  }

  if (input.status === "paid") {
    return "settled";
  }

  if (input.status === "pending" || input.status === "open") {
    return "pending_return_window";
  }

  if (
    input.status === "failed" ||
    input.status === "canceled" ||
    input.status === "expired"
  ) {
    const normalizedReason = (input.statusReason ?? "").toLowerCase();
    const isMandateProblem = mandateProblemReasonFragments.some((fragment) =>
      normalizedReason.includes(fragment),
    );

    return isMandateProblem ? "mandate_problem_review" : "failed_needs_review";
  }

  return "not_applicable";
}
