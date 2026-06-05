import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const CONSENT_TOKEN_CIPHERTEXT_VERSION = "v1";
const CONSENT_TOKEN_CIPHER_ALGORITHM = "aes-256-gcm";

export type StoredConsentToken = {
  consentToken: string | null;
  consentTokenCiphertext: string | null;
};

function getConsentTokenKey() {
  const authSecret = process.env.AUTH_SECRET?.trim();

  if (!authSecret) {
    throw new Error("AUTH_SECRET is missing.");
  }

  return createHash("sha256")
    .update("mollie-manager:consent-token-storage:")
    .update(authSecret)
    .digest();
}

export function createConsentToken() {
  return crypto.randomUUID().replaceAll("-", "");
}

export function hashConsentToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function encryptConsentToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(CONSENT_TOKEN_CIPHER_ALGORITHM, getConsentTokenKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    CONSENT_TOKEN_CIPHERTEXT_VERSION,
    iv.toString("hex"),
    authTag.toString("hex"),
    ciphertext.toString("hex"),
  ].join(":");
}

export function decryptConsentToken(ciphertext: string) {
  const [version, ivHex, authTagHex, payloadHex] = ciphertext.split(":");

  if (
    version !== CONSENT_TOKEN_CIPHERTEXT_VERSION ||
    !ivHex ||
    !authTagHex ||
    !payloadHex
  ) {
    throw new Error("Stored consent token ciphertext is invalid.");
  }

  const decipher = createDecipheriv(
    CONSENT_TOKEN_CIPHER_ALGORITHM,
    getConsentTokenKey(),
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));

  const token = Buffer.concat([
    decipher.update(Buffer.from(payloadHex, "hex")),
    decipher.final(),
  ]).toString("utf8");

  if (!token) {
    throw new Error("Stored consent token resolved to an empty value.");
  }

  return token;
}

export function buildConsentTokenStorage(token: string) {
  return {
    consentTokenCiphertext: encryptConsentToken(token),
    consentTokenHash: hashConsentToken(token),
  };
}

export function resolveStoredConsentToken(input: StoredConsentToken) {
  if (input.consentToken) {
    return input.consentToken;
  }

  if (!input.consentTokenCiphertext) {
    return null;
  }

  return decryptConsentToken(input.consentTokenCiphertext);
}
