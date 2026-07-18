export type AttentionPresentationRecord = {
  itemType: string;
  severity: "critical" | "warning";
  type: "customer" | "payment" | "subscription" | "system";
};

export type NeedsAttentionImpact = {
  description: string;
  label: string;
};

export function getNeedsAttentionImpact(
  item: AttentionPresentationRecord,
): NeedsAttentionImpact {
  if (
    [
      "failed_payment",
      "reversed_payment",
      "mandate_problem",
      "expired_payment",
      "failed_first_payment_invoice",
      "failed_recurring_invoice",
      "failed_invoice_delivery",
    ].includes(item.itemType)
  ) {
    return {
      description: "Payment or invoice obligation may need manual recovery.",
      label: "Revenue and collection",
    };
  }

  if (
    [
      "mollie_invoicing_required",
      "mollie_payment_methods_required",
      "eboekhouden_relation_problem",
      "missing_mandate",
      "payment_action_required_subscription",
      "pending_subscription_cancellation",
      "subscription_out_of_sync",
    ].includes(item.itemType)
  ) {
    return {
      description: item.itemType === "mollie_payment_methods_required"
        ? "Mollie profile setup is blocking new customer payments and recurring collection."
        : item.itemType === "mollie_invoicing_required"
          ? "Mollie organization setup is blocking invoice creation."
        : "Customer setup or lifecycle review is blocking safe next steps.",
      label: item.itemType === "mollie_payment_methods_required"
        ? "Mollie payment setup"
        : item.itemType === "mollie_invoicing_required"
          ? "Mollie invoice setup"
        : "Customer setup and lifecycle",
    };
  }

  return {
    description: "Sync or webhook reliability should be checked before acting on stale data.",
    label: "System reliability",
  };
}

export function getNeedsAttentionPriorityMeta(
  severity: AttentionPresentationRecord["severity"],
) {
  if (severity === "critical") {
    return {
      description: "Resolve before more billing or lifecycle changes.",
      title: "Critical priority",
    };
  }

  return {
    description: "Review soon so manual follow-up stays safe and deliberate.",
    title: "Review soon",
  };
}
