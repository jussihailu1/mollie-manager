export type CustomerLifecycleState =
  | "active"
  | "cancelled"
  | "ended"
  | "needs_setup"
  | "onboarding"
  | "paused"
  | "payment_issue";

export type CustomerLifecycleReason =
  | "active_subscription"
  | "cancelled_subscription"
  | "future_charges_stopped"
  | "mandate_missing_or_invalid"
  | "onboarding_in_progress"
  | "payment_failed_or_reversed"
  | "relation_missing_or_problem"
  | "service_period_ended"
  | "subscription_payment_action_required"
  | "subscription_setup_pending";

export type CustomerLifecycleStateResult = {
  reason: CustomerLifecycleReason;
  state: CustomerLifecycleState;
  summary: string;
};

export type CustomerLifecycleFacts = {
  archivedAt?: string | null;
  eboekhoudenLinkStatus?: "linked" | "needs_review" | "sync_error" | "unlinked" | null;
  hasValidMandate?: boolean | null;
  latestConsentAcceptedAt?: string | null;
  latestFirstPaymentStatus?: string | null;
  latestPaymentStatus?: string | null;
  latestPaymentType?: string | null;
  latestSubscriptionMollieStatus?: string | null;
  latestSubscriptionServiceEndAt?: string | null;
  latestSubscriptionStatus?: string | null;
  latestSubscriptionStopAfterCurrentPeriod?: boolean | null;
  subscriptionCount?: number | null;
};

function isPastDate(value: string | null | undefined, now: Date) {
  if (!value) {
    return false;
  }

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) && timestamp <= now.getTime();
}

function hasPaymentIssue(facts: CustomerLifecycleFacts) {
  return (
    facts.latestPaymentStatus === "failed" ||
    facts.latestPaymentStatus === "expired" ||
    facts.latestSubscriptionStatus === "payment_action_required" ||
    facts.latestSubscriptionStatus === "charged_back" ||
    facts.latestSubscriptionMollieStatus === "suspended"
  );
}

function isSetupPending(facts: CustomerLifecycleFacts) {
  return (
    facts.latestSubscriptionStatus === "awaiting_first_payment" ||
    facts.latestSubscriptionStatus === "mandate_pending"
  );
}

function hasOnboardingEvidence(facts: CustomerLifecycleFacts) {
  return Boolean(
    facts.latestConsentAcceptedAt ||
      facts.latestFirstPaymentStatus ||
      facts.latestSubscriptionStatus === "draft" ||
      (facts.subscriptionCount ?? 0) > 0,
  );
}

export function deriveCustomerLifecycleState(
  facts: CustomerLifecycleFacts,
  options?: {
    now?: Date;
  },
): CustomerLifecycleStateResult {
  const now = options?.now ?? new Date();

  if (isPastDate(facts.latestSubscriptionServiceEndAt, now)) {
    return {
      reason: "service_period_ended",
      state: "ended",
      summary: "Service period has ended.",
    };
  }

  if (
    facts.archivedAt ||
    facts.latestSubscriptionStatus === "cancelled" ||
    facts.latestSubscriptionMollieStatus === "canceled"
  ) {
    return {
      reason: "cancelled_subscription",
      state: "cancelled",
      summary: "Subscription is cancelled or the customer is archived.",
    };
  }

  if (
    facts.latestSubscriptionStopAfterCurrentPeriod ||
    facts.latestSubscriptionStatus === "future_charges_stopped"
  ) {
    return {
      reason: "future_charges_stopped",
      state: "cancelled",
      summary: "Future charges are stopped. Service may continue until its separate end date.",
    };
  }

  if (hasPaymentIssue(facts)) {
    return {
      reason:
        facts.latestSubscriptionStatus === "payment_action_required"
          ? "subscription_payment_action_required"
          : "payment_failed_or_reversed",
      state: "payment_issue",
      summary: "Latest payment or subscription state requires manual payment review.",
    };
  }

  if (isSetupPending(facts)) {
    return {
      reason: "subscription_setup_pending",
      state: "needs_setup",
      summary: "Subscription setup is still waiting on first payment or mandate completion.",
    };
  }

  if (
    facts.latestSubscriptionStatus === "active" &&
    facts.hasValidMandate === false
  ) {
    return {
      reason: "mandate_missing_or_invalid",
      state: "needs_setup",
      summary: "Active subscription has no usable mandate on record.",
    };
  }

  if (facts.latestSubscriptionStatus === "active") {
    return {
      reason: "active_subscription",
      state: "active",
      summary: "Customer has an active subscription.",
    };
  }

  if (hasOnboardingEvidence(facts)) {
    return {
      reason: "onboarding_in_progress",
      state: "onboarding",
      summary: "Customer is still in the onboarding flow.",
    };
  }

  return {
    reason: "relation_missing_or_problem",
    state: "needs_setup",
    summary: "Customer setup has not started or is missing required billing context.",
  };
}
