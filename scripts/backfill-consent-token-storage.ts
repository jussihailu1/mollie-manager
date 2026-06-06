import { loadEnvConfig } from "@next/env";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

loadEnvConfig(process.cwd());

type LegacyConsentRow = {
  consentId: string;
  consentToken: string;
};

async function main() {
  const [{ buildConsentTokenStorage }] = await Promise.all([
    import("../lib/onboarding/consent-token-storage"),
  ]);

  const connectionString = process.env.DATABASE_URL;
  const useSsl = process.env.DATABASE_SSL === "true";

  if (!connectionString) {
    throw new Error("DATABASE_URL is required to backfill consent token storage.");
  }

  const pool = new pg.Pool({
    connectionString,
    ssl: useSsl ? true : undefined,
  });
  const db = drizzle(pool);
  const batchSize = 200;
  let updatedCount = 0;

  try {
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
  } finally {
    await pool.end();
  }

  console.log(`Backfilled consent token storage for ${updatedCount} consent rows.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
