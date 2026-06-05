import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.AUTH_SECRET ??= "test-auth-secret-00000000000000000000";

describe("consent token storage helpers", () => {
  it("hashes lookup tokens and encrypts recoverable storage", async () => {
    const {
      buildConsentTokenStorage,
      hashConsentToken,
      resolveStoredConsentToken,
    } = await import("@/lib/onboarding/consent-token-storage");

    const token = "4f1dd5a27b8e48c3982b0f71f4c6c37e";
    const storage = buildConsentTokenStorage(token);

    assert.equal(storage.consentTokenHash, hashConsentToken(token));
    assert.notEqual(storage.consentTokenCiphertext, token);
    assert.equal(
      resolveStoredConsentToken({
        consentToken: null,
        consentTokenCiphertext: storage.consentTokenCiphertext,
      }),
      token,
    );
  });

  it("prefers an existing legacy plaintext token when present", async () => {
    const { resolveStoredConsentToken } = await import("@/lib/onboarding/consent-token-storage");

    assert.equal(
      resolveStoredConsentToken({
        consentToken: "legacy-token-123",
        consentTokenCiphertext: null,
      }),
      "legacy-token-123",
    );
  });
});
