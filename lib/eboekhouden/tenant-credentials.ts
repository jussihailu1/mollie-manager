import "server-only";

import { sql } from "drizzle-orm";

import { getDb, transaction } from "@/lib/db";
import {
  decryptTenantCredential,
  encryptTenantCredential,
} from "@/lib/tenant-credential-encryption";

const TENANT_EBOEKHOUDEN_CREDENTIAL_SCOPE =
  "mollie-manager:tenant-eboekhouden-credentials:";

type StoredTenantEboekhoudenCredentials = {
  apiSource: string;
  apiTokenCiphertext: string;
};

export class TenantEboekhoudenCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantEboekhoudenCredentialError";
  }
}

function requireTenantId(tenantId?: string) {
  if (!tenantId) {
    throw new TenantEboekhoudenCredentialError(
      "Explicit tenant context is required.",
    );
  }

  return tenantId;
}

export function encryptTenantEboekhoudenApiToken(token: string) {
  return encryptTenantCredential(token, {
    createError: (message) => new TenantEboekhoudenCredentialError(message),
    currentSecret: process.env.APP_ENCRYPTION_KEY,
    currentSecretMissingMessage: "APP_ENCRYPTION_KEY is missing.",
    scope: TENANT_EBOEKHOUDEN_CREDENTIAL_SCOPE,
  });
}

export function decryptTenantEboekhoudenApiToken(ciphertext: string) {
  return decryptTenantCredential(ciphertext, {
    createError: (message) => new TenantEboekhoudenCredentialError(message),
    currentSecret: process.env.APP_ENCRYPTION_KEY,
    currentSecretMissingMessage: "APP_ENCRYPTION_KEY is missing.",
    invalidMessage: "Stored tenant e-Boekhouden credentials are invalid.",
    legacySecret: process.env.AUTH_SECRET,
    legacySecretMissingMessage:
      "Stored tenant e-Boekhouden credentials still require AUTH_SECRET for legacy decryption.",
    scope: TENANT_EBOEKHOUDEN_CREDENTIAL_SCOPE,
  });
}

export async function getTenantEboekhoudenCredentials(tenantId: string) {
  const result = await getDb().execute<StoredTenantEboekhoudenCredentials>(sql`
    select
      api_source as "apiSource",
      api_token_ciphertext as "apiTokenCiphertext"
    from tenant_eboekhouden_credentials
    where tenant_id = ${tenantId}
    limit 1
  `);

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    apiSource: row.apiSource,
    apiToken: decryptTenantEboekhoudenApiToken(row.apiTokenCiphertext),
  };
}

export async function upsertTenantEboekhoudenCredentials(
  input: {
    apiSource: string;
    apiToken: string;
  },
  tenantId: string,
) {
  const ciphertext = encryptTenantEboekhoudenApiToken(input.apiToken);

  await transaction(async (tx) => {
    await tx.execute(sql`
      insert into tenant_eboekhouden_credentials (
        id,
        tenant_id,
        api_source,
        api_token_ciphertext,
        created_at,
        updated_at
      ) values (
        ${tenantId},
        ${tenantId},
        ${input.apiSource},
        ${ciphertext},
        now(),
        now()
      )
      on conflict (tenant_id)
      do update set
        api_source = excluded.api_source,
        api_token_ciphertext = excluded.api_token_ciphertext,
        updated_at = now()
    `);
  });
}

export async function resolveTenantEboekhoudenConfig(tenantId?: string) {
  const resolvedTenantId = requireTenantId(tenantId);
  const stored = await getTenantEboekhoudenCredentials(resolvedTenantId);

  if (stored) {
    return {
      EBOEKHOUDEN_API_SOURCE: stored.apiSource,
      EBOEKHOUDEN_API_TOKEN: stored.apiToken,
    };
  }

  throw new TenantEboekhoudenCredentialError(
    "Tenant e-Boekhouden credentials are missing.",
  );
}
