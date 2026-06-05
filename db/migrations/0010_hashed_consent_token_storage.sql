ALTER TABLE subscription_onboarding_consents
  ALTER COLUMN consent_token DROP NOT NULL;

ALTER TABLE subscription_onboarding_consents
  ADD COLUMN consent_token_hash text;

ALTER TABLE subscription_onboarding_consents
  ADD COLUMN consent_token_ciphertext text;

ALTER TABLE subscription_onboarding_consents
  ADD CONSTRAINT subscription_onboarding_consents_consent_token_hash_key
  UNIQUE (consent_token_hash);

ALTER TABLE subscription_onboarding_consents
  ADD CONSTRAINT subscription_onboarding_consents_token_storage_check
  CHECK (
    (
      consent_token_hash IS NULL
      AND consent_token_ciphertext IS NULL
      AND consent_token IS NOT NULL
    )
    OR (
      consent_token_hash IS NOT NULL
      AND consent_token_ciphertext IS NOT NULL
    )
  );
