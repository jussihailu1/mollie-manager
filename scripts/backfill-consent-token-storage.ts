import { loadEnvConfig } from "@next/env";
import { sql } from "drizzle-orm";

loadEnvConfig(process.cwd());

type LegacyConsentRow = {
  consentId: string;
  consentToken: string;
};

const [{ getDb }, { buildConsentTokenStorage }] = await Promise.all([
  import("../lib/db"),
  import("../lib/onboarding/consent-token-storage"),
]);

const db = getDb();
const batchSize = 200;
let updatedCount = 0;

for (;;) {
  const result = await db.execute<LegacyConsentRow>(sql`
    select
      id as "consentId",
      consent_token as "consentToken"
    from subscription_onboarding_consents
    where consent_token is not null
    order by created_at asc
    limit ${batchSize}
  `);

  if (result.rows.length === 0) {
    break;
  }

  for (const row of result.rows) {
    const storage = buildConsentTokenStorage(row.consentToken);

    await db.execute(sql`
      update subscription_onboarding_consents
      set
        consent_token = null,
        consent_token_hash = ${storage.consentTokenHash},
        consent_token_ciphertext = ${storage.consentTokenCiphertext},
        updated_at = now()
      where id = ${row.consentId}
        and consent_token = ${row.consentToken}
    `);

    updatedCount += 1;
  }
}

console.log(`Backfilled consent token storage for ${updatedCount} consent rows.`);
