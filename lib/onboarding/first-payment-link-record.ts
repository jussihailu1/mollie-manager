import { PaymentMethod, SequenceType } from "@mollie/api-client";

export type FirstPaymentLinkAmount = {
  currency: string;
  value: string;
};

export type FirstPaymentLinkLike = {
  allowedMethods?: unknown;
  amount?: FirstPaymentLinkAmount | null;
  archived?: boolean | null;
  paidAt?: string | null;
  reusable?: boolean | null;
  sequenceType?: string | null;
};

export type FirstPaymentLinkMetadata = {
  allowedMethods: unknown;
  latestPaymentId: null;
  latestPaymentStatus: null;
  mollieCustomerId: string;
  paymentType: "first";
  redirectUrl: string;
  reusable: boolean;
  sequenceType: string;
  source: "subscription_onboarding";
};

export function deriveFirstPaymentLinkStatus(paymentLink: FirstPaymentLinkLike) {
  if (paymentLink.archived) {
    return "archived";
  }

  return paymentLink.paidAt ? "paid" : "open";
}

export function deriveFirstPaymentLinkAmount(
  paymentLink: FirstPaymentLinkLike,
  fallbackAmountValue: string,
): FirstPaymentLinkAmount {
  return paymentLink.amount ?? {
    currency: "EUR",
    value: fallbackAmountValue,
  };
}

export function buildFirstPaymentLinkMetadata(input: {
  mollieCustomerId: string;
  paymentLink: FirstPaymentLinkLike;
  redirectUrl: string;
}): FirstPaymentLinkMetadata {
  return {
    allowedMethods: input.paymentLink.allowedMethods ?? [PaymentMethod.ideal],
    latestPaymentId: null,
    latestPaymentStatus: null,
    mollieCustomerId: input.mollieCustomerId,
    paymentType: "first",
    redirectUrl: input.redirectUrl,
    reusable: input.paymentLink.reusable ?? false,
    sequenceType: input.paymentLink.sequenceType ?? SequenceType.first,
    source: "subscription_onboarding",
  };
}
