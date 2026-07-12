import "server-only";

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { env, type MollieMode } from "@/lib/env";
import { getDb, transaction } from "@/lib/db";
import {
  decryptTenantCredential,
  encryptTenantCredential,
} from "@/lib/tenant-credential-encryption";

const TENANT_MOLLIE_CREDENTIAL_SCOPE =
  "mollie-manager:tenant-mollie-credentials:";

type StoredTenantMollieCredentials = {
  apiKeyCiphertext: string;
};

export class TenantMollieCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantMollieCredentialError";
  }
}

function requireTenantId(tenantId?: string) {
  if (!tenantId) {
    throw new TenantMollieCredentialError("Explicit tenant context is required.");
  }

  return tenantId;
}

export function encryptTenantMollieApiKey(apiKey: string) {
  return encryptTenantCredential(apiKey, {
    createError: (message) => new TenantMollieCredentialError(message),
    currentSecret: process.env.APP_ENCRYPTION_KEY,
    currentSecretMissingMessage: "APP_ENCRYPTION_KEY is missing.",
    scope: TENANT_MOLLIE_CREDENTIAL_SCOPE,
  });
}

export function decryptTenantMollieApiKey(ciphertext: string) {
  return decryptTenantCredential(ciphertext, {
    createError: (message) => new TenantMollieCredentialError(message),
    currentSecret: process.env.APP_ENCRYPTION_KEY,
    currentSecretMissingMessage: "APP_ENCRYPTION_KEY is missing.",
    invalidMessage: "Stored tenant Mollie credentials are invalid.",
    legacySecret: process.env.AUTH_SECRET,
    legacySecretMissingMessage:
      "Stored tenant Mollie credentials still require AUTH_SECRET for legacy decryption.",
    scope: TENANT_MOLLIE_CREDENTIAL_SCOPE,
  });
}

export async function getTenantMollieCredentials(
  tenantId: string,
  mode: MollieMode,
) {
  const result = await getDb().execute<StoredTenantMollieCredentials>(sql`
    select
      api_key_ciphertext as "apiKeyCiphertext"
    from tenant_mollie_credentials
    where tenant_id = ${tenantId}
      and mode = ${mode}
    limit 1
  `);

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    apiKey: decryptTenantMollieApiKey(row.apiKeyCiphertext),
  };
}

export async function upsertTenantMollieCredentials(
  input: {
    apiKey: string;
    mode: MollieMode;
  },
  tenantId: string,
) {
  const ciphertext = encryptTenantMollieApiKey(input.apiKey);

  await transaction(async (tx) => {
    await tx.execute(sql`
      insert into tenant_mollie_credentials (
        id,
        tenant_id,
        mode,
        api_key_ciphertext,
        created_at,
        updated_at
      ) values (
        ${randomUUID()},
        ${tenantId},
        ${input.mode},
        ${ciphertext},
        now(),
        now()
      )
      on conflict (tenant_id, mode)
      do update set
        api_key_ciphertext = excluded.api_key_ciphertext,
        updated_at = now()
    `);
  });
}

export async function resolveTenantMollieConfig(
  tenantId?: string,
  mode: MollieMode = env.MOLLIE_DEFAULT_MODE,
) {
  const resolvedTenantId = requireTenantId(tenantId);
  const stored = await getTenantMollieCredentials(resolvedTenantId, mode);

  if (stored) {
    return {
      MOLLIE_API_KEY: stored.apiKey,
    };
  }

  throw new TenantMollieCredentialError("Tenant Mollie credentials are missing.");
}
