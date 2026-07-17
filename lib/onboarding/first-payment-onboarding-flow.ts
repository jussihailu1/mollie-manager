import { PaymentMethod, SequenceType } from "@mollie/api-client";

import type { MollieMode } from "@/lib/env";
import { getMollieWebhookUrl, getTenantMollieClient, getTenantMollieRequestContext } from "@/lib/mollie/client";
import { buildConsentTokenStorage, createConsentToken } from "@/lib/onboarding/consent-token-storage";
import { buildFirstPaymentOnboardingRecords } from "@/lib/onboarding/first-payment-onboarding-records";
import { persistFirstPaymentOnboardingRecords, type FirstPaymentOnboardingActor } from "@/lib/onboarding/first-payment-onboarding-persistence";
import { buildFirstPaymentPlan, type FirstPaymentPlanInput } from "@/lib/onboarding/first-payment-plan";
import { buildSubscriptionConsentReturnUrl } from "@/lib/subscription-consent";
import { ensureTenantSubscriptionPolicyDefaults } from "@/lib/subscription-policy-defaults";

export type FirstPaymentOnboardingFlowInput = {
  actor: FirstPaymentOnboardingActor;
  customer: {
    id: string;
    mollieCustomerId: string;
  };
  planInput: Omit<FirstPaymentPlanInput, "tenantPolicy">;
  selectedMode: MollieMode;
  tenantId: string;
};

export async function createFirstPaymentOnboardingFlow(
  input: FirstPaymentOnboardingFlowInput,
) {
  const tenantPolicy = await ensureTenantSubscriptionPolicyDefaults(input.tenantId);
  const firstPaymentPlan = buildFirstPaymentPlan({
    ...input.planInput,
    tenantPolicy: {
      cancellationEmail: tenantPolicy.cancellationEmail,
      defaultCancellationEffect: tenantPolicy.defaultCancellationEffect,
      privacyUrl: tenantPolicy.privacyUrl,
      termsUrl: tenantPolicy.termsUrl,
      termsVersion: tenantPolicy.termsVersion,
    },
  });
  const mollie = await getTenantMollieClient(
    input.tenantId,
    input.selectedMode,
  );
  const { profileId, testmode } = await getTenantMollieRequestContext(input.tenantId, input.selectedMode);
  const localPaymentLinkId = crypto.randomUUID();
  const localConsentId = crypto.randomUUID();
  const consentToken = createConsentToken();
  const consentTokenStorage = buildConsentTokenStorage(consentToken);
  const webhookUrl = getMollieWebhookUrl();
  const redirectUrl = buildSubscriptionConsentReturnUrl(consentToken);
  const paymentLink = await mollie.paymentLinks.create({
    allowedMethods: [PaymentMethod.ideal],
    amount: {
      currency: "EUR",
      value: firstPaymentPlan.amountValue,
    },
    customerId: input.customer.mollieCustomerId,
    description: firstPaymentPlan.paymentDescription,
    idempotencyKey: crypto.randomUUID(),
    ...(profileId ? { profileId } : {}),
    redirectUrl,
    reusable: false,
    sequenceType: SequenceType.first,
    ...(testmode ? { testmode } : {}),
    webhookUrl,
  });
  const onboardingRecords = buildFirstPaymentOnboardingRecords({
    consentTokenStorage,
    customerId: input.customer.id,
    fallbackAmountValue: firstPaymentPlan.amountValue,
    firstPaymentMode: input.planInput.firstPaymentMode,
    localConsentId,
    localPaymentLinkId,
    mollieCustomerId: input.customer.mollieCustomerId,
    paymentLink,
    planSnapshot: firstPaymentPlan.planSnapshot,
    redirectUrl,
    selectedMode: input.selectedMode,
    termsVersion: tenantPolicy.termsVersion,
  });

  await persistFirstPaymentOnboardingRecords({
    actor: input.actor,
    onboardingRecords,
    selectedMode: input.selectedMode,
  });
}
