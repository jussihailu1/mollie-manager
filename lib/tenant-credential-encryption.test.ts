import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

function buildLegacyCiphertext(scope: string, value: string, authSecret: string) {
  const iv = randomBytes(12);
  const key = createHash("sha256").update(scope).update(authSecret).digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("hex"),
    authTag.toString("hex"),
    ciphertext.toString("hex"),
  ].join(":");
}

describe("tenant credential encryption", () => {
  const source = readFileSync(
    resolve("lib/tenant-credential-encryption.ts"),
    "utf8",
  );

  it("keeps current and legacy credential versions explicit in the shared helper", () => {
    assert.match(source, /const TENANT_CREDENTIAL_VERSION = "v2";/);
    assert.match(source, /const LEGACY_TENANT_CREDENTIAL_VERSION = "v1";/);
  });

  it("uses APP_ENCRYPTION_KEY for new tenant e-Boekhouden and Mollie credential writes", async () => {
    process.env.APP_ENCRYPTION_KEY = "app-encryption-key-0000000000000000000000000001";
    process.env.AUTH_SECRET = "auth-secret-00000000000000000000000000000001";

    const { decryptTenantCredential, encryptTenantCredential } = await import(
      "@/lib/tenant-credential-encryption"
    );

    const encryptedToken = encryptTenantCredential("eboekhouden-token", {
      createError: (message) => new Error(message),
      currentSecret: process.env.APP_ENCRYPTION_KEY,
      currentSecretMissingMessage: "APP_ENCRYPTION_KEY is missing.",
      scope: "mollie-manager:tenant-eboekhouden-credentials:",
    });
    const encryptedKey = encryptTenantCredential("test_mollie-key", {
      createError: (message) => new Error(message),
      currentSecret: process.env.APP_ENCRYPTION_KEY,
      currentSecretMissingMessage: "APP_ENCRYPTION_KEY is missing.",
      scope: "mollie-manager:tenant-mollie-credentials:",
    });

    assert.match(encryptedToken, /^v2:/);
    assert.match(encryptedKey, /^v2:/);
    assert.equal(
      decryptTenantCredential(encryptedToken, {
        createError: (message) => new Error(message),
        currentSecret: process.env.APP_ENCRYPTION_KEY,
        currentSecretMissingMessage: "APP_ENCRYPTION_KEY is missing.",
        invalidMessage: "Stored tenant e-Boekhouden credentials are invalid.",
        legacySecret: process.env.AUTH_SECRET,
        legacySecretMissingMessage:
          "Stored tenant e-Boekhouden credentials still require AUTH_SECRET for legacy decryption.",
        scope: "mollie-manager:tenant-eboekhouden-credentials:",
      }),
      "eboekhouden-token",
    );
    assert.equal(
      decryptTenantCredential(encryptedKey, {
        createError: (message) => new Error(message),
        currentSecret: process.env.APP_ENCRYPTION_KEY,
        currentSecretMissingMessage: "APP_ENCRYPTION_KEY is missing.",
        invalidMessage: "Stored tenant Mollie credentials are invalid.",
        legacySecret: process.env.AUTH_SECRET,
        legacySecretMissingMessage:
          "Stored tenant Mollie credentials still require AUTH_SECRET for legacy decryption.",
        scope: "mollie-manager:tenant-mollie-credentials:",
      }),
      "test_mollie-key",
    );

    process.env.APP_ENCRYPTION_KEY = "app-encryption-key-0000000000000000000000000009";

    assert.throws(
      () =>
        decryptTenantCredential(encryptedToken, {
          createError: (message) => new Error(message),
          currentSecret: process.env.APP_ENCRYPTION_KEY,
          currentSecretMissingMessage: "APP_ENCRYPTION_KEY is missing.",
          invalidMessage: "Stored tenant e-Boekhouden credentials are invalid.",
          legacySecret: process.env.AUTH_SECRET,
          legacySecretMissingMessage:
            "Stored tenant e-Boekhouden credentials still require AUTH_SECRET for legacy decryption.",
          scope: "mollie-manager:tenant-eboekhouden-credentials:",
        }),
      /Stored tenant e-Boekhouden credentials are invalid\./,
    );
  });

  it("keeps legacy AUTH_SECRET decryption readable for existing tenant ciphertext", async () => {
    process.env.APP_ENCRYPTION_KEY = "app-encryption-key-0000000000000000000000000002";
    process.env.AUTH_SECRET = "auth-secret-00000000000000000000000000000002";

    const { decryptTenantCredential } = await import(
      "@/lib/tenant-credential-encryption"
    );

    const legacyEboekhoudenCiphertext = buildLegacyCiphertext(
      "mollie-manager:tenant-eboekhouden-credentials:",
      "legacy-eboekhouden-token",
      process.env.AUTH_SECRET,
    );
    const legacyMollieCiphertext = buildLegacyCiphertext(
      "mollie-manager:tenant-mollie-credentials:",
      "legacy-mollie-key",
      process.env.AUTH_SECRET,
    );

    assert.equal(
      decryptTenantCredential(legacyEboekhoudenCiphertext, {
        createError: (message) => new Error(message),
        currentSecret: process.env.APP_ENCRYPTION_KEY,
        currentSecretMissingMessage: "APP_ENCRYPTION_KEY is missing.",
        invalidMessage: "Stored tenant e-Boekhouden credentials are invalid.",
        legacySecret: process.env.AUTH_SECRET,
        legacySecretMissingMessage:
          "Stored tenant e-Boekhouden credentials still require AUTH_SECRET for legacy decryption.",
        scope: "mollie-manager:tenant-eboekhouden-credentials:",
      }),
      "legacy-eboekhouden-token",
    );
    assert.equal(
      decryptTenantCredential(legacyMollieCiphertext, {
        createError: (message) => new Error(message),
        currentSecret: process.env.APP_ENCRYPTION_KEY,
        currentSecretMissingMessage: "APP_ENCRYPTION_KEY is missing.",
        invalidMessage: "Stored tenant Mollie credentials are invalid.",
        legacySecret: process.env.AUTH_SECRET,
        legacySecretMissingMessage:
          "Stored tenant Mollie credentials still require AUTH_SECRET for legacy decryption.",
        scope: "mollie-manager:tenant-mollie-credentials:",
      }),
      "legacy-mollie-key",
    );

    delete process.env.AUTH_SECRET;

    assert.throws(
      () =>
        decryptTenantCredential(legacyEboekhoudenCiphertext, {
          createError: (message) => new Error(message),
          currentSecret: process.env.APP_ENCRYPTION_KEY,
          currentSecretMissingMessage: "APP_ENCRYPTION_KEY is missing.",
          invalidMessage: "Stored tenant e-Boekhouden credentials are invalid.",
          legacySecret: process.env.AUTH_SECRET,
          legacySecretMissingMessage:
            "Stored tenant e-Boekhouden credentials still require AUTH_SECRET for legacy decryption.",
          scope: "mollie-manager:tenant-eboekhouden-credentials:",
        }),
      /Stored tenant e-Boekhouden credentials still require AUTH_SECRET for legacy decryption\./,
    );
  });

  it("fails closed when APP_ENCRYPTION_KEY is missing for new tenant credential writes", async () => {
    delete process.env.APP_ENCRYPTION_KEY;
    process.env.AUTH_SECRET = "auth-secret-00000000000000000000000000000003";

    const { encryptTenantCredential } = await import(
      "@/lib/tenant-credential-encryption"
    );

    assert.throws(
      () =>
        encryptTenantCredential("eboekhouden-token", {
          createError: (message) => new Error(message),
          currentSecret: process.env.APP_ENCRYPTION_KEY,
          currentSecretMissingMessage: "APP_ENCRYPTION_KEY is missing.",
          scope: "mollie-manager:tenant-eboekhouden-credentials:",
        }),
      /APP_ENCRYPTION_KEY is missing\./,
    );
    assert.throws(
      () =>
        encryptTenantCredential("test_mollie-key", {
          createError: (message) => new Error(message),
          currentSecret: process.env.APP_ENCRYPTION_KEY,
          currentSecretMissingMessage: "APP_ENCRYPTION_KEY is missing.",
          scope: "mollie-manager:tenant-mollie-credentials:",
        }),
      /APP_ENCRYPTION_KEY is missing\./,
    );
  });
});
