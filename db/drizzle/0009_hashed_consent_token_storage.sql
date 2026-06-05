ALTER TABLE "subscription_onboarding_consents" ALTER COLUMN "consent_token" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_onboarding_consents" ADD COLUMN "consent_token_hash" text;--> statement-breakpoint
ALTER TABLE "subscription_onboarding_consents" ADD COLUMN "consent_token_ciphertext" text;--> statement-breakpoint
ALTER TABLE "subscription_onboarding_consents" ADD CONSTRAINT "subscription_onboarding_consents_consent_token_hash_key" UNIQUE("consent_token_hash");--> statement-breakpoint
ALTER TABLE "subscription_onboarding_consents" ADD CONSTRAINT "subscription_onboarding_consents_token_storage_check" CHECK ((
        ("subscription_onboarding_consents"."consent_token_hash" is null and "subscription_onboarding_consents"."consent_token_ciphertext" is null and "subscription_onboarding_consents"."consent_token" is not null)
        or ("subscription_onboarding_consents"."consent_token_hash" is not null and "subscription_onboarding_consents"."consent_token_ciphertext" is not null)
      ));
