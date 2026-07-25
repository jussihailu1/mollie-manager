import type { SubscriptionActivationResult } from "@/lib/onboarding/subscription-activation";

export type SubscriptionActivationFeedback = {
  error: string | null;
  notice: string | null;
  shouldRevalidate: boolean;
};

export function describeSubscriptionActivationResult(
  result: SubscriptionActivationResult,
): SubscriptionActivationFeedback {
  if (result.status === "created") {
    return {
      error: null,
      notice:
        result.firstPaymentMode === "real_installment"
          ? "Subscription activation retried successfully. Future charges are now scheduled in Mollie."
          : "Subscription created. Future charges are now scheduled in Mollie.",
      shouldRevalidate: true,
    };
  }

  if (result.status === "already_exists") {
    return {
      error: null,
      notice:
        result.reason === "consent_already_used"
          ? "A subscription already exists for this onboarding flow."
          : "This customer already has a local subscription record in progress or active.",
      shouldRevalidate: false,
    };
  }

  if (result.status === "pending_prerequisites") {
    return {
      error:
        result.reason === "archived"
          ? "Restore this customer before creating a subscription."
          : result.reason === "customer_not_linked"
            ? "Customer not found in the selected Mollie mode or not linked to Mollie."
            : result.reason === "missing_consent"
              ? "No accepted consent was found yet. Complete the consent flow first."
              : result.reason === "missing_mandate"
                ? "No pending or valid direct debit mandate is available yet. Sync the customer first."
                : "A successful first payment is required before creating the subscription.",
      notice: null,
      shouldRevalidate: false,
    };
  }

  return {
    error: result.message,
    notice: null,
    shouldRevalidate: false,
  };
}
