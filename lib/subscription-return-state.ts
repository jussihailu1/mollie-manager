export type SubscriptionReturnStateInput = {
  firstPaymentMode: "mandate_only" | "real_installment";
  firstPaymentStatus: string | null;
  paymentLinkStatus: string | null;
  subscriptionStatus: string | null;
};

export type SubscriptionReturnState = {
  description: string;
  nextStep: string;
  pending: boolean;
  tone: "issue" | "pending" | "success";
  title: string;
};

const unsuccessfulStatuses = new Set(["canceled", "cancelled", "expired", "failed"]);
const issueSubscriptionStatuses = new Set([
  "charged_back",
  "out_of_sync",
  "payment_action_required",
]);

function hasUnsuccessfulCheckoutStatus(input: SubscriptionReturnStateInput) {
  return (
    unsuccessfulStatuses.has(input.firstPaymentStatus ?? "") ||
    unsuccessfulStatuses.has(input.paymentLinkStatus ?? "")
  );
}

export function getSubscriptionReturnState(
  input: SubscriptionReturnStateInput,
): SubscriptionReturnState {
  if (input.subscriptionStatus && issueSubscriptionStatuses.has(input.subscriptionStatus)) {
    return {
      description:
        "Your setup needs manual review before the business can confirm the subscription.",
      nextStep:
        "Please contact the business if you need access urgently. No automatic penalty or cancellation is applied from this page.",
      pending: false,
      title: "Setup needs review",
      tone: "issue",
    };
  }

  if (input.subscriptionStatus) {
    return {
      description: "Your payment was received and the subscription setup is complete.",
      nextStep: "You can close this page.",
      pending: false,
      title: "Subscription confirmed",
      tone: "success",
    };
  }

  if (input.firstPaymentMode === "mandate_only" && input.firstPaymentStatus === "paid") {
    return {
      description:
        "The mandate setup payment completed successfully. The business can now continue subscription setup separately.",
      nextStep: "You can close this page.",
      pending: false,
      title: "Mandate setup completed",
      tone: "success",
    };
  }

  if (input.firstPaymentStatus === "paid") {
    return {
      description: "Payment received. We are confirming your subscription now.",
      nextStep:
        "This page refreshes automatically while setup finishes. You can contact the business if this message stays here.",
      pending: true,
      title: "Payment received",
      tone: "pending",
    };
  }

  if (hasUnsuccessfulCheckoutStatus(input)) {
    return {
      description:
        "The checkout did not complete successfully, so the subscription setup is not confirmed yet.",
      nextStep:
        "Please contact the business for help or a new payment link. Any invoice or payment obligation will be handled separately by the business.",
      pending: false,
      title: "Payment not completed",
      tone: "issue",
    };
  }

  return {
    description:
      "We are confirming your payment status. SEPA direct debit payments can stay pending for several days before the final status is known.",
    nextStep:
      "Keep this page open for a moment. If it does not change, the business can still verify the payment manually.",
    pending: true,
    title: "Confirming payment",
    tone: "pending",
  };
}
