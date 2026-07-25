CREATE TABLE IF NOT EXISTS subscription_activation_jobs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  consent_id text NOT NULL,
  mode mollie_mode NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  claim_token text,
  subscription_id text REFERENCES subscriptions(id) ON DELETE SET NULL,
  last_error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_activation_jobs_tenant_mode_consent_key UNIQUE (tenant_id, mode, consent_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS subscription_activation_jobs_due_idx ON subscription_activation_jobs (tenant_id, mode, status, next_attempt_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS subscription_activation_notifications (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  subscription_id text REFERENCES subscriptions(id) ON DELETE SET NULL,
  job_id text REFERENCES subscription_activation_jobs(id) ON DELETE SET NULL,
  mode mollie_mode NOT NULL,
  notification_type text NOT NULL,
  event_key text NOT NULL,
  recipient_email text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  subject text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claim_token text,
  last_error_message text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_activation_notifications_event_recipient_key UNIQUE (tenant_id, mode, notification_type, event_key, recipient_email)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS subscription_activation_notifications_due_idx ON subscription_activation_notifications (tenant_id, mode, status, next_attempt_at);
