export type SubscriptionSyncSource = {
  nextPaymentDate?: string | null;
  startDate?: string | null;
  status: string;
};

export function deriveSubscriptionBillingDay(
  subscription: SubscriptionSyncSource,
) {
  return subscription.startDate
    ? new Date(`${subscription.startDate}T00:00:00Z`).getUTCDate()
    : null;
}

export function shouldStopSubscriptionAfterCurrentPeriod(
  subscription: SubscriptionSyncSource,
) {
  return subscription.status === "canceled" || subscription.status === "completed";
}

export function buildSubscriptionSyncMetadata(
  subscription: SubscriptionSyncSource,
) {
  return {
    nextPaymentDate: subscription.nextPaymentDate ?? null,
  };
}
