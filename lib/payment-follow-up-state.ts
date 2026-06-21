export type PaymentFollowUpAlertStatus =
  | "open"
  | "acknowledged"
  | "resolved"
  | "absent";

export type PaymentFollowUpNotificationStatus =
  | "claimed"
  | "sent"
  | "failed"
  | "skipped"
  | "absent";

export type PaymentFollowUpStateInput = {
  alertStatus: PaymentFollowUpAlertStatus;
  notificationStatus: PaymentFollowUpNotificationStatus;
  sentAt: Date | number | string | null;
  failedAt: Date | number | string | null;
  claimedAt: Date | number | string | null;
  attemptCount: number;
};

export type PaymentFollowUpTaskStatus =
  | "operator_work"
  | "completed"
  | "untracked";

export type PaymentFollowUpDeliveryStatus =
  | "delivery_in_progress"
  | "customer_notified"
  | "delivery_failed"
  | "delivery_skipped"
  | "no_delivery_evidence";

export type PaymentFollowUpUrgency = "high" | "medium" | "none";

export type PaymentFollowUpState = {
  taskStatus: PaymentFollowUpTaskStatus;
  taskLabel: string;
  notificationStatus: PaymentFollowUpDeliveryStatus;
  notificationLabel: string;
  urgency: PaymentFollowUpUrgency;
  recommendedAction: string;
};

const notificationPresentation: Record<
  PaymentFollowUpNotificationStatus,
  Pick<PaymentFollowUpState, "notificationStatus" | "notificationLabel">
> = {
  claimed: {
    notificationStatus: "delivery_in_progress",
    notificationLabel: "Delivery in progress",
  },
  sent: {
    notificationStatus: "customer_notified",
    notificationLabel: "Customer notified",
  },
  failed: {
    notificationStatus: "delivery_failed",
    notificationLabel: "Notification failed",
  },
  skipped: {
    notificationStatus: "delivery_skipped",
    notificationLabel: "Notification skipped",
  },
  absent: {
    notificationStatus: "no_delivery_evidence",
    notificationLabel: "No delivery evidence",
  },
};

function deriveTaskPresentation(
  status: PaymentFollowUpAlertStatus,
): Pick<PaymentFollowUpState, "taskStatus" | "taskLabel"> {
  if (status === "resolved") {
    return {
      taskStatus: "completed",
      taskLabel: "Follow-up completed",
    };
  }

  if (status === "absent") {
    return {
      taskStatus: "untracked",
      taskLabel: "No follow-up task",
    };
  }

  return {
    taskStatus: "operator_work",
    taskLabel: "Operator follow-up required",
  };
}

function deriveUrgency(
  alertStatus: PaymentFollowUpAlertStatus,
  notificationStatus: PaymentFollowUpNotificationStatus,
): PaymentFollowUpUrgency {
  if (alertStatus === "resolved") {
    return "none";
  }

  if (
    notificationStatus === "failed" ||
    notificationStatus === "absent" ||
    alertStatus === "open"
  ) {
    return "high";
  }

  return "medium";
}

function deriveRecommendedAction(
  alertStatus: PaymentFollowUpAlertStatus,
  notificationStatus: PaymentFollowUpNotificationStatus,
) {
  if (notificationStatus === "failed") {
    return "Check email settings and contact details, then review whether manual customer contact is appropriate.";
  }

  if (alertStatus === "resolved") {
    return "No further follow-up is recommended for the completed task.";
  }

  if (notificationStatus === "claimed") {
    return "Confirm delivery completes before deciding on manual customer contact.";
  }

  if (notificationStatus === "sent") {
    return "Continue the operator review with the customer notification recorded as sent.";
  }

  if (notificationStatus === "skipped") {
    return "Review why notification was skipped and decide whether manual customer contact is appropriate.";
  }

  return "Review the failed payment and decide whether manual customer contact is appropriate; there is no delivery evidence.";
}

export function derivePaymentFollowUpState(
  input: PaymentFollowUpStateInput,
): PaymentFollowUpState {
  return {
    ...deriveTaskPresentation(input.alertStatus),
    ...notificationPresentation[input.notificationStatus],
    urgency: deriveUrgency(input.alertStatus, input.notificationStatus),
    recommendedAction: deriveRecommendedAction(
      input.alertStatus,
      input.notificationStatus,
    ),
  };
}
