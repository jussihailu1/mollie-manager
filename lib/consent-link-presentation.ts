import "server-only";

import { sql } from "drizzle-orm";
import { cache } from "react";

import type { ConsentLinkShareDetails } from "@/lib/consent-link-sharing";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { buildConsentLinkUrl } from "@/lib/onboarding/consent-link";
import { hashConsentToken, resolveStoredConsentToken } from "@/lib/onboarding/consent-token-storage";
import { consentTokenSchema } from "@/lib/subscription-consent-acceptance";

// Presentation reads must never accept consent, create a payment, or migrate tokens.
const presentationColumns = sql`
  coalesce(nullif(btrim(tip.trade_name), ''), nullif(btrim(tip.legal_name), ''), nullif(btrim(t.name), '')) as "issuerName",
  soc.first_payment_mode as "firstPaymentMode",
  soc.plan_snapshot ->> 'firstPaymentAmountValue' as "firstPaymentAmountValue"
`;
const presentationTables = sql`
  from subscription_onboarding_consents soc
  inner join tenants t on t.id = soc.tenant_id
  inner join customers c on c.id = soc.customer_id and c.tenant_id = soc.tenant_id and c.mode = soc.mode
  inner join payment_links pl on pl.id = soc.payment_link_id and pl.tenant_id = soc.tenant_id and pl.mode = soc.mode
  left join tenant_invoice_profiles tip on tip.tenant_id = soc.tenant_id
`;

export const getConsentLinkPresentationByToken = cache(async (token: string) => {
  const parsed = consentTokenSchema.safeParse(token);
  if (!parsed.success) return null;

  const hash = hashConsentToken(parsed.data);
  const result = await getDb().execute<ConsentLinkShareDetails>(sql`
    select ${presentationColumns}
    ${presentationTables}
    where soc.consent_token_hash = ${hash} or soc.consent_token = ${parsed.data}
    order by case when soc.consent_token_hash = ${hash} then 0 else 1 end, soc.created_at desc
    limit 1
  `);
  return result.rows[0] ?? null;
});

export async function getLatestConsentLinkPresentation(
  customerId: string,
  mode: "live" | "test",
  tenantId: string,
) {
  const result = await getDb().execute<ConsentLinkShareDetails & {
    consentToken: string | null;
    consentTokenCiphertext: string | null;
  }>(sql`
    select ${presentationColumns},
      soc.consent_token as "consentToken",
      soc.consent_token_ciphertext as "consentTokenCiphertext"
    ${presentationTables}
    where soc.customer_id = ${customerId} and soc.tenant_id = ${tenantId} and soc.mode = ${mode}
    order by soc.created_at desc
    limit 1
  `);
  const row = result.rows[0];
  const token = row ? resolveStoredConsentToken(row) : null;
  if (!row || !token) return { latestConsentUrl: null, shareDetails: null };

  return {
    latestConsentUrl: buildConsentLinkUrl(token, env.APP_URL),
    shareDetails: {
      issuerName: row.issuerName,
      firstPaymentMode: row.firstPaymentMode,
      firstPaymentAmountValue: row.firstPaymentAmountValue,
    } satisfies ConsentLinkShareDetails,
  };
}
