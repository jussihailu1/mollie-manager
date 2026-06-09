const archiveBlockedSubscriptionStatuses = new Set([
  "active",
  "awaiting_first_payment",
  "draft",
  "mandate_pending",
  "payment_action_required",
]);

export type CustomerArchivePolicySubscription = {
  localStatus: string;
};

export function resolveCustomerArchiveBlocker(input: {
  archivedAt: string | null;
  subscriptions: CustomerArchivePolicySubscription[];
}) {
  if (input.archivedAt) {
    return {
      kind: "notice" as const,
      message: "Customer is already archived.",
    };
  }

  const blockingSubscription = input.subscriptions.find((subscription) =>
    archiveBlockedSubscriptionStatuses.has(subscription.localStatus),
  );

  if (blockingSubscription) {
    return {
      kind: "error" as const,
      message: "Cancel or stop active billing before archiving this customer.",
    };
  }

  return null;
}

export function resolveCustomerRestoreBlocker(archivedAt: string | null) {
  if (archivedAt) {
    return null;
  }

  return {
    kind: "notice" as const,
    message: "Customer is already active.",
  };
}
