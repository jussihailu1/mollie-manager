import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const TENANT_CREDENTIAL_VERSION = "v2";
const LEGACY_TENANT_CREDENTIAL_VERSION = "v1";
const TENANT_CREDENTIAL_ALGORITHM = "aes-256-gcm";

type TenantCredentialErrorFactory = (message: string) => Error;

function deriveTenantCredentialKey(scope: string, secret: string) {
  return createHash("sha256").update(scope).update(secret).digest();
}

function requireSecret(
  secret: string | undefined,
  message: string,
  createError: TenantCredentialErrorFactory,
) {
  const trimmedSecret = secret?.trim();

  if (!trimmedSecret) {
    throw createError(message);
  }

  return trimmedSecret;
}

export function encryptTenantCredential(
  value: string,
  options: {
    createError: TenantCredentialErrorFactory;
    currentSecret: string | undefined;
    currentSecretMissingMessage: string;
    scope: string;
  },
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    TENANT_CREDENTIAL_ALGORITHM,
    deriveTenantCredentialKey(
      options.scope,
      requireSecret(
        options.currentSecret,
        options.currentSecretMissingMessage,
        options.createError,
      ),
    ),
    iv,
  );
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    TENANT_CREDENTIAL_VERSION,
    iv.toString("hex"),
    authTag.toString("hex"),
    ciphertext.toString("hex"),
  ].join(":");
}

export function decryptTenantCredential(
  ciphertext: string,
  options: {
    createError: TenantCredentialErrorFactory;
    currentSecret: string | undefined;
    currentSecretMissingMessage: string;
    invalidMessage: string;
    legacySecret: string | undefined;
    legacySecretMissingMessage: string;
    scope: string;
  },
) {
  const [version, ivHex, authTagHex, payloadHex] = ciphertext.split(":");

  if (
    (version !== TENANT_CREDENTIAL_VERSION &&
      version !== LEGACY_TENANT_CREDENTIAL_VERSION) ||
    !ivHex ||
    !authTagHex ||
    !payloadHex
  ) {
    throw options.createError(options.invalidMessage);
  }

  try {
    const secret =
      version === LEGACY_TENANT_CREDENTIAL_VERSION
        ? requireSecret(
            options.legacySecret,
            options.legacySecretMissingMessage,
            options.createError,
          )
        : requireSecret(
            options.currentSecret,
            options.currentSecretMissingMessage,
            options.createError,
          );
    const decipher = createDecipheriv(
      TENANT_CREDENTIAL_ALGORITHM,
      deriveTenantCredentialKey(options.scope, secret),
      Buffer.from(ivHex, "hex"),
    );
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));

    return Buffer.concat([
      decipher.update(Buffer.from(payloadHex, "hex")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === options.currentSecretMissingMessage ||
        error.message === options.legacySecretMissingMessage)
    ) {
      throw error;
    }

    throw options.createError(options.invalidMessage);
  }
}
