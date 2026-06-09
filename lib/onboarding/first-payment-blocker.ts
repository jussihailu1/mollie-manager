const renewableFirstPaymentLinkStatuses = new Set([
  "archived",
  "canceled",
  "expired",
  "failed",
]);

const reusableFirstPaymentStatuses = new Set(["canceled", "expired", "failed"]);

export type FirstPaymentBlockerPayment = {
  mollieStatus: string | null;
  paymentType: string;
};

export type FirstPaymentBlockerPaymentLink = {
  mollieStatus: string | null;
};

export function resolveFirstPaymentCreationBlocker(input: {
  paymentLinks: FirstPaymentBlockerPaymentLink[];
  payments: FirstPaymentBlockerPayment[];
}) {
  const existingFirstPayment = input.payments.find(
    (payment) =>
      payment.paymentType === "first" &&
      !reusableFirstPaymentStatuses.has(payment.mollieStatus ?? "open"),
  );

  if (existingFirstPayment) {
    return existingFirstPayment.mollieStatus === "paid"
      ? "A paid first payment already exists for this customer."
      : "A first payment already exists for this customer. Reuse or sync it before creating another one.";
  }

  const existingFirstPaymentLink = input.paymentLinks.find(
    (paymentLink) =>
      !renewableFirstPaymentLinkStatuses.has(paymentLink.mollieStatus ?? "open"),
  );

  if (existingFirstPaymentLink) {
    return existingFirstPaymentLink.mollieStatus === "paid"
      ? "A paid first payment link already exists for this customer. Sync it before creating another one."
      : "A first payment link already exists for this customer. Reuse or sync it before creating another one.";
  }

  return null;
}
