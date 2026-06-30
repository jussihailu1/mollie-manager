import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomUUID, randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { env, getMollieApiKey, type MollieMode } from "@/lib/env";
import { getDb, transaction } from "@/lib/db";
import { LEGACY_DEFAULT_TENANT_ID } from "@/lib/tenants";

const TENANT_CREDENTIAL_VERSION = "v1";
const TENANT_CREDENTIAL_ALGORITHM = "aes-256-gcm";

type StoredTenantMollieCredentials = {
  apiKeyCiphertext: string;
};

export class TenantMollieCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantMollieCredentialError";
  }
}

function getTenantMollieCredentialKey() {
  const authSecret = process.env.AUTH_SECRET?.trim();

  if (!authSecret) {
    throw new TenantMollieCredentialError("AUTH_SECRET is missing.");
  }

  return createHash("sha256")
    .update("mollie-manager:tenant-mollie-credentials:")
    .update(authSecret)
    .digest();
}

export function encryptTenantMollieApiKey(apiKey: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    TENANT_CREDENTIAL_ALGORITHM,
    getTenantMollieCredentialKey(),
    iv,
  );
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    TENANT_CREDENTIAL_VERSION,
    iv.toString("hex"),
    authTag.toString("hex"),
    ciphertext.toString("hex"),
  ].join(":");
}

export function decryptTenantMollieApiKey(ciphertext: string) {
  const [version, ivHex, authTagHex, payloadHex] = ciphertext.split(":");

  if (
    version !== TENANT_CREDENTIAL_VERSION ||
    !ivHex ||
    !authTagHex ||
    !payloadHex
  ) {
    throw new TenantMollieCredentialError(
      "Stored tenant Mollie credentials are invalid.",
    );
  }

  try {
    const decipher = createDecipheriv(
      TENANT_CREDENTIAL_ALGORITHM,
      getTenantMollieCredentialKey(),
      Buffer.from(ivHex, "hex"),
    );
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));

    return Buffer.concat([
      decipher.update(Buffer.from(payloadHex, "hex")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new TenantMollieCredentialError(
      "Stored tenant Mollie credentials are invalid.",
    );
  }
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
  if (!tenantId) {
    return {
      MOLLIE_API_KEY: getMollieApiKey(mode),
    };
  }

  const stored = await getTenantMollieCredentials(tenantId, mode);

  if (stored) {
    return {
      MOLLIE_API_KEY: stored.apiKey,
    };
  }

  if (tenantId === LEGACY_DEFAULT_TENANT_ID) {
    return {
      MOLLIE_API_KEY: getMollieApiKey(mode),
    };
  }

  throw new TenantMollieCredentialError("Tenant Mollie credentials are missing.");
}
