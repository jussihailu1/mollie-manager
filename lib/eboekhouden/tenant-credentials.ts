import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { getDb, transaction } from "@/lib/db";
import { getEboekhoudenConfig } from "@/lib/env";
import { LEGACY_DEFAULT_TENANT_ID } from "@/lib/tenants";

const TENANT_CREDENTIAL_VERSION = "v1";
const TENANT_CREDENTIAL_ALGORITHM = "aes-256-gcm";

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

function getTenantEboekhoudenCredentialKey() {
  const authSecret = process.env.AUTH_SECRET?.trim();

  if (!authSecret) {
    throw new TenantEboekhoudenCredentialError("AUTH_SECRET is missing.");
  }

  return createHash("sha256")
    .update("mollie-manager:tenant-eboekhouden-credentials:")
    .update(authSecret)
    .digest();
}

export function encryptTenantEboekhoudenApiToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    TENANT_CREDENTIAL_ALGORITHM,
    getTenantEboekhoudenCredentialKey(),
    iv,
  );
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    TENANT_CREDENTIAL_VERSION,
    iv.toString("hex"),
    authTag.toString("hex"),
    ciphertext.toString("hex"),
  ].join(":");
}

export function decryptTenantEboekhoudenApiToken(ciphertext: string) {
  const [version, ivHex, authTagHex, payloadHex] = ciphertext.split(":");

  if (
    version !== TENANT_CREDENTIAL_VERSION ||
    !ivHex ||
    !authTagHex ||
    !payloadHex
  ) {
    throw new TenantEboekhoudenCredentialError(
      "Stored tenant e-Boekhouden credentials are invalid.",
    );
  }

  try {
    const decipher = createDecipheriv(
      TENANT_CREDENTIAL_ALGORITHM,
      getTenantEboekhoudenCredentialKey(),
      Buffer.from(ivHex, "hex"),
    );
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));

    return Buffer.concat([
      decipher.update(Buffer.from(payloadHex, "hex")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new TenantEboekhoudenCredentialError(
      "Stored tenant e-Boekhouden credentials are invalid.",
    );
  }
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
  if (!tenantId) {
    return getEboekhoudenConfig();
  }

  const stored = await getTenantEboekhoudenCredentials(tenantId);

  if (stored) {
    return {
      EBOEKHOUDEN_API_SOURCE: stored.apiSource,
      EBOEKHOUDEN_API_TOKEN: stored.apiToken,
    };
  }

  if (tenantId === LEGACY_DEFAULT_TENANT_ID) {
    return getEboekhoudenConfig();
  }

  throw new TenantEboekhoudenCredentialError(
    "Tenant e-Boekhouden credentials are missing.",
  );
}
