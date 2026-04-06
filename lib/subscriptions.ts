export function mapSubscriptionLifecycle(status: string | null | undefined) {
  switch (status) {
    case "active":
      return "active";
    case "pending":
      return "mandate_pending";
    case "suspended":
      return "payment_action_required";
    case "completed":
    case "canceled":
      return "future_charges_stopped";
    default:
      return "draft";
  }
}
