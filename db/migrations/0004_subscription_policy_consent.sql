DO $$ BEGIN
  CREATE TYPE subscription_term_mode AS ENUM ('open_ended', 'fixed_term');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE cancellation_effect AS ENUM ('immediate', 'end_of_paid_period');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE first_payment_mode AS ENUM ('real_installment', 'mandate_only');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS subscription_term_mode subscription_term_mode NOT NULL DEFAULT 'open_ended',
  ADD COLUMN IF NOT EXISTS total_payments integer,
  ADD COLUMN IF NOT EXISTS last_charge_date date,
  ADD COLUMN IF NOT EXISTS service_end_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_effect cancellation_effect NOT NULL DEFAULT 'end_of_paid_period';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'subscriptions_total_payments_positive_check'
  ) THEN
    ALTER TABLE subscriptions
      ADD CONSTRAINT subscriptions_total_payments_positive_check
      CHECK (total_payments IS NULL OR total_payments > 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'subscriptions_term_mode_total_payments_check'
  ) THEN
    ALTER TABLE subscriptions
      ADD CONSTRAINT subscriptions_term_mode_total_payments_check
      CHECK (
        (
          subscription_term_mode = 'fixed_term' AND total_payments IS NOT NULL
        ) OR (
          subscription_term_mode = 'open_ended' AND total_payments IS NULL
        )
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS tenant_subscription_policy_defaults (
  id text PRIMARY KEY,
  cancellation_email text NOT NULL,
  terms_url text NOT NULL,
  privacy_url text NOT NULL,
  terms_version text NOT NULL,
  default_cancellation_effect cancellation_effect NOT NULL DEFAULT 'end_of_paid_period',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscription_onboarding_consents (
  id text PRIMARY KEY,
  mode mollie_mode NOT NULL,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  payment_link_id text NOT NULL REFERENCES payment_links(id) ON DELETE CASCADE,
  consent_token text NOT NULL,
  first_payment_mode first_payment_mode NOT NULL,
  terms_version text NOT NULL,
  required_checkbox_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  accepted_checkbox_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  plan_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  accepted_at timestamptz,
  accepted_ip text,
  accepted_user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consent_token),
  UNIQUE (mode, payment_link_id)
);

CREATE INDEX IF NOT EXISTS subscription_onboarding_consents_customer_idx
  ON subscription_onboarding_consents (customer_id, created_at DESC);

