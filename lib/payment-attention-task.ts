import type { RecurringCollectionState } from "@/lib/recurring-billing-policy";

export type PaymentAttentionTaskInput = {
  disputedAt?: string | null;
  mollieStatus?: string | null;
  paymentType: "first" | "manual" | "recurring" | "refund" | string;
  recurringCollectionState: RecurringCollectionState;
};

export type PaymentAttentionTask = {
  safeNextAction: string;
  severity: "critical" | "warning";
  summary: string;
  title: string;
};

export function derivePaymentAttentionTask(
  input: PaymentAttentionTaskInput,
): PaymentAttentionTask | null {
  if (
    input.disputedAt ||
    input.recurringCollectionState === "reversal_critical_review"
  ) {
    return {
      safeNextAction:
        "Review Mollie and the invoice before changing service or billing state.",
      severity: "critical",
      summary:
        "A payment was reversed or disputed. The invoice obligation may still be open.",
      title: "Payment reversed or disputed",
    };
  }

  if (input.recurringCollectionState === "mandate_problem_review") {
    return {
      safeNextAction:
        "Ask for a valid mandate or alternative payment path before relying on automatic collection again.",
      severity: "critical",
      summary:
        "A recurring payment failed with a possible mandate or bank-account problem.",
      title: "Mandate problem",
    };
  }

  if (input.recurringCollectionState === "failed_needs_review") {
    return {
      safeNextAction:
        "Keep the existing invoice open and review manually before retrying or changing service state.",
      severity: "warning",
      summary:
        "A recurring payment failed or stayed pending beyond the safe processing window.",
      title: "Recurring payment needs review",
    };
  }

  if (input.mollieStatus === "failed") {
    return {
      safeNextAction:
        "Review the customer and payment before taking any follow-up action.",
      severity: "warning",
      summary: "A payment failed and should be reviewed before service continues.",
      title: "Failed payment",
    };
  }

  if (input.mollieStatus === "expired") {
    return {
      safeNextAction:
        "Review whether the customer still needs a new payment link or setup step.",
      severity: "warning",
      summary: "A checkout expired before the customer completed payment.",
      title: "Expired payment",
    };
  }

  return null;
}

