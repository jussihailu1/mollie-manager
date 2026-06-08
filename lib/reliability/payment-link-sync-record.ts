type PaymentLinkAmount = {
  currency: string;
  value: string;
};

export type PaymentLinkSyncPayment = {
  amount?: PaymentLinkAmount;
  id: string;
  status: string;
};

export type PaymentLinkSyncSource = {
  allowedMethods?: string[];
  amount?: PaymentLinkAmount;
  archived: boolean;
  customerId?: string;
  minimumAmount?: PaymentLinkAmount;
  paidAt?: string;
  redirectUrl?: string;
  reusable?: boolean | null;
  sequenceType: string;
};

const unsuccessfulPaymentStatuses = new Set(["canceled", "expired", "failed"]);

export function derivePaymentLinkSyncStatus(
  paymentLink: PaymentLinkSyncSource,
  payments: PaymentLinkSyncPayment[],
) {
  const latestPayment = payments[0] ?? null;

  if (paymentLink.archived) {
    return "archived";
  }

  if (paymentLink.paidAt || payments.some((payment) => payment.status === "paid")) {
    return "paid";
  }

  if (latestPayment && unsuccessfulPaymentStatuses.has(latestPayment.status)) {
    return latestPayment.status;
  }

  return "open";
}

export function derivePaymentLinkSyncAmount(
  paymentLink: PaymentLinkSyncSource,
  payments: PaymentLinkSyncPayment[],
) {
  return (
    paymentLink.amount ??
    paymentLink.minimumAmount ??
    payments[0]?.amount ?? {
      currency: "EUR",
      value: "0.00",
    }
  );
}

export function buildPaymentLinkSyncMetadata(input: {
  existingMetadata?: Record<string, unknown>;
  paymentLink: PaymentLinkSyncSource;
  payments: PaymentLinkSyncPayment[];
}) {
  const latestPayment = input.payments[0] ?? null;
  const existingMetadata = input.existingMetadata ?? {};

  return {
    ...existingMetadata,
    allowedMethods: input.paymentLink.allowedMethods ?? ["ideal"],
    latestPaymentId: latestPayment?.id ?? null,
    latestPaymentStatus: latestPayment?.status ?? null,
    mollieCustomerId: input.paymentLink.customerId ?? null,
    paymentIds: input.payments.map((payment) => payment.id),
    paymentType: "first",
    redirectUrl:
      input.paymentLink.redirectUrl ??
      (typeof existingMetadata.redirectUrl === "string"
        ? existingMetadata.redirectUrl
        : null),
    reusable: input.paymentLink.reusable ?? false,
    sequenceType: input.paymentLink.sequenceType,
    source: "subscription_onboarding",
  };
}
