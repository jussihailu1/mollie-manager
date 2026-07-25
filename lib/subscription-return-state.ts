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
      description: "There is a problem confirming your subscription.",
      nextStep: "Please contact the business for help.",
      pending: false,
      title: "Setup needs review",
      tone: "issue",
    };
  }

  if (input.subscriptionStatus) {
    return {
      description: "Thank you. Your subscription is now active.",
      nextStep: "You can safely close this tab.",
      pending: false,
      title: "Subscription confirmed",
      tone: "success",
    };
  }

  if (input.firstPaymentMode === "mandate_only" && input.firstPaymentStatus === "paid") {
    return {
      description: "Thank you. Your payment details have been confirmed.",
      nextStep: "You can safely close this tab.",
      pending: false,
      title: "Mandate setup completed",
      tone: "success",
    };
  }

  if (input.firstPaymentStatus === "paid") {
    return {
      description: "Thank you. We have received your payment.",
      nextStep: "You can safely close this tab.",
      pending: true,
      title: "Payment received",
      tone: "pending",
    };
  }

  if (hasUnsuccessfulCheckoutStatus(input)) {
    return {
      description: "Your payment was not completed.",
      nextStep: "Please contact the business for help or a new payment link.",
      pending: false,
      title: "Payment not completed",
      tone: "issue",
    };
  }

  return {
    description: "We are confirming your payment. This can take a little longer for SEPA Direct Debit payments.",
    nextStep: "You can safely close this tab.",
    pending: true,
    title: "Confirming payment",
    tone: "pending",
  };
}
