import "server-only";

import { sql } from "drizzle-orm";

import { getDb, transaction } from "@/lib/db";
import { getSubscriptionPolicyConfig } from "@/lib/env";
import type { CancellationEffect } from "@/lib/subscription-policy";

export const TENANT_SUBSCRIPTION_POLICY_DEFAULT_ID = "default";

export type TenantSubscriptionPolicyRow = {
  cancellationEmail: string;
  defaultCancellationEffect: CancellationEffect;
  id: string;
  privacyUrl: string;
  termsUrl: string;
  termsVersion: string;
};

async function readTenantSubscriptionPolicyDefaults() {
  const result = await getDb().execute<TenantSubscriptionPolicyRow>(sql`
    select
      id,
      cancellation_email as "cancellationEmail",
      terms_url as "termsUrl",
      privacy_url as "privacyUrl",
      terms_version as "termsVersion",
      default_cancellation_effect as "defaultCancellationEffect"
    from tenant_subscription_policy_defaults
    where id = ${TENANT_SUBSCRIPTION_POLICY_DEFAULT_ID}
    limit 1
  `);

  return result.rows[0] ?? null;
}

export async function ensureTenantSubscriptionPolicyDefaults() {
  const existing = await readTenantSubscriptionPolicyDefaults();

  if (existing) {
    return existing;
  }

  const envDefaults = getSubscriptionPolicyConfig();

  await transaction(async (tx) => {
    await tx.execute(sql`
      insert into tenant_subscription_policy_defaults (
        id,
        cancellation_email,
        terms_url,
        privacy_url,
        terms_version,
        default_cancellation_effect,
        created_at,
        updated_at
      ) values (
        ${TENANT_SUBSCRIPTION_POLICY_DEFAULT_ID},
        ${envDefaults.SUBSCRIPTION_CANCELLATION_EMAIL},
        ${envDefaults.SUBSCRIPTION_TERMS_URL},
        ${envDefaults.SUBSCRIPTION_PRIVACY_URL},
        ${envDefaults.SUBSCRIPTION_TERMS_VERSION},
        'end_of_paid_period',
        now(),
        now()
      )
      on conflict (id) do nothing
    `);
  });

  const inserted = await readTenantSubscriptionPolicyDefaults();

  if (!inserted) {
    throw new Error("Failed to initialize tenant subscription policy defaults.");
  }

  return inserted;
}

export async function getTenantSubscriptionPolicyDefaults() {
  const defaults = await readTenantSubscriptionPolicyDefaults();

  if (!defaults) {
    throw new Error("Subscription policy defaults are missing. Configure env and create defaults.");
  }

  return defaults;
}

