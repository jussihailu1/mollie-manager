import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import { transaction } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import type { FirstPaymentOnboardingRecords } from "@/lib/onboarding/first-payment-onboarding-records";
import { requireCustomerTenantId } from "@/lib/tenant-ownership";

export type FirstPaymentOnboardingActor = {
  email?: string | null;
  kind: "system" | "user";
};

export async function persistFirstPaymentOnboardingRecords(input: {
  actor: FirstPaymentOnboardingActor;
  onboardingRecords: FirstPaymentOnboardingRecords;
  selectedMode: MollieMode;
}) {
  const tenantId = await requireCustomerTenantId(
    input.onboardingRecords.paymentLinkRecord.customerId,
  );
  await transaction(async (client) => {
    await client.execute(sql`
        insert into payment_links (
          id,
          tenant_id,
          customer_id,
          mode,
          mollie_payment_link_id,
          mollie_status,
          description,
          amount_value,
          amount_currency,
          checkout_url,
          expires_at,
          metadata,
          created_at,
          updated_at,
          last_synced_at
        ) values (
          ${input.onboardingRecords.auditDetails.localPaymentLinkId},
          ${tenantId},
          ${input.onboardingRecords.paymentLinkRecord.customerId},
          ${input.onboardingRecords.paymentLinkRecord.mode},
          ${input.onboardingRecords.paymentLinkRecord.molliePaymentLinkId},
          ${input.onboardingRecords.paymentLinkRecord.mollieStatus},
          ${input.onboardingRecords.paymentLinkRecord.description},
          ${input.onboardingRecords.paymentLinkRecord.amountValue},
          ${input.onboardingRecords.paymentLinkRecord.amountCurrency},
          ${input.onboardingRecords.paymentLinkRecord.checkoutUrl},
          ${input.onboardingRecords.paymentLinkRecord.expiresAt}::timestamptz,
          ${JSON.stringify(input.onboardingRecords.paymentLinkRecord.metadata)}::jsonb,
          coalesce(${input.onboardingRecords.paymentLinkRecord.createdAt}::timestamptz, now()),
          now(),
          now()
        )
      `);
    await client.execute(sql`
        insert into subscription_onboarding_consents (
          id,
          tenant_id,
          mode,
          customer_id,
          payment_link_id,
          consent_token,
          consent_token_hash,
          consent_token_ciphertext,
          first_payment_mode,
          terms_version,
          required_checkbox_keys,
          accepted_checkbox_keys,
          plan_snapshot,
          accepted_at,
          accepted_ip,
          accepted_user_agent,
          created_at,
          updated_at
        ) values (
          ${input.onboardingRecords.consentRecord.id},
          ${tenantId},
          ${input.onboardingRecords.consentRecord.mode},
          ${input.onboardingRecords.consentRecord.customerId},
          ${input.onboardingRecords.consentRecord.paymentLinkId},
          ${input.onboardingRecords.consentRecord.consentToken},
          ${input.onboardingRecords.consentRecord.consentTokenHash},
          ${input.onboardingRecords.consentRecord.consentTokenCiphertext},
          ${input.onboardingRecords.consentRecord.firstPaymentMode},
          ${input.onboardingRecords.consentRecord.termsVersion},
          ${JSON.stringify(input.onboardingRecords.consentRecord.requiredCheckboxKeys)}::jsonb,
          ${JSON.stringify(input.onboardingRecords.consentRecord.acceptedCheckboxKeys)}::jsonb,
          ${JSON.stringify(input.onboardingRecords.consentRecord.planSnapshot)}::jsonb,
          ${input.onboardingRecords.consentRecord.acceptedAt},
          ${input.onboardingRecords.consentRecord.acceptedIp},
          ${input.onboardingRecords.consentRecord.acceptedUserAgent},
          now(),
          now()
        )
      `);

    await writeAuditLog(
      {
        action: "payment_link.first.create",
        details: input.onboardingRecords.auditDetails,
        entityId: input.onboardingRecords.auditDetails.localPaymentLinkId,
        entityType: "payment_link",
        mode: input.selectedMode,
        outcome: "success",
        summary: "Created a durable first-payment link for mandate setup.",
      },
      client,
      input.actor,
    );
  });
}
