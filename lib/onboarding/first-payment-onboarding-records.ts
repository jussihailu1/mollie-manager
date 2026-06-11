import type { FirstPaymentLinkLike } from "@/lib/onboarding/first-payment-link-record";
import {
  buildFirstPaymentLinkMetadata,
  deriveFirstPaymentLinkAmount,
  deriveFirstPaymentLinkStatus,
} from "@/lib/onboarding/first-payment-link-record";
import type { MollieMode } from "@/lib/env";
import {
  REQUIRED_CONSENT_CHECKBOX_KEYS,
  type ConsentPlanSnapshot,
  type FirstPaymentMode,
} from "@/lib/subscription-policy";

export type FirstPaymentOnboardingRecordInput = {
  consentTokenStorage: {
    consentTokenCiphertext: string;
    consentTokenHash: string;
  };
  customerId: string;
  fallbackAmountValue: string;
  firstPaymentMode: FirstPaymentMode;
  localConsentId: string;
  localPaymentLinkId: string;
  mollieCustomerId: string;
  paymentLink: FirstPaymentLinkLike & {
    createdAt?: string;
    description: string;
    expiresAt?: string;
    getPaymentUrl: () => string;
    id: string;
  };
  planSnapshot: ConsentPlanSnapshot;
  redirectUrl: string;
  selectedMode: MollieMode;
  termsVersion: string;
};

export function buildFirstPaymentOnboardingRecords(
  input: FirstPaymentOnboardingRecordInput,
) {
  const paymentLinkStatus = deriveFirstPaymentLinkStatus(input.paymentLink);
  const paymentLinkAmount = deriveFirstPaymentLinkAmount(
    input.paymentLink,
    input.fallbackAmountValue,
  );
  const paymentLinkMetadata = buildFirstPaymentLinkMetadata({
    mollieCustomerId: input.mollieCustomerId,
    paymentLink: input.paymentLink,
    redirectUrl: input.redirectUrl,
  });

  return {
    auditDetails: {
      localPaymentLinkId: input.localPaymentLinkId,
      molliePaymentLinkId: input.paymentLink.id,
    },
    consentRecord: {
      acceptedAt: null,
      acceptedCheckboxKeys: [],
      acceptedIp: null,
      acceptedUserAgent: null,
      consentToken: null,
      consentTokenCiphertext: input.consentTokenStorage.consentTokenCiphertext,
      consentTokenHash: input.consentTokenStorage.consentTokenHash,
      createdAt: null,
      customerId: input.customerId,
      firstPaymentMode: input.firstPaymentMode,
      id: input.localConsentId,
      mode: input.selectedMode,
      paymentLinkId: input.localPaymentLinkId,
      planSnapshot: input.planSnapshot,
      requiredCheckboxKeys: [...REQUIRED_CONSENT_CHECKBOX_KEYS],
      termsVersion: input.termsVersion,
      updatedAt: null,
    },
    paymentLinkRecord: {
      amountCurrency: paymentLinkAmount.currency,
      amountValue: paymentLinkAmount.value,
      checkoutUrl: input.paymentLink.getPaymentUrl(),
      createdAt: input.paymentLink.createdAt ?? null,
      customerId: input.customerId,
      description: input.paymentLink.description,
      expiresAt: input.paymentLink.expiresAt ?? null,
      metadata: paymentLinkMetadata,
      molliePaymentLinkId: input.paymentLink.id,
      mollieStatus: paymentLinkStatus,
      mode: input.selectedMode,
    },
  };
}
