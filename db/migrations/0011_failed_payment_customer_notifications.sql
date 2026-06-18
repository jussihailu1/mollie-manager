CREATE TYPE customer_payment_notification_status AS ENUM (
  'claimed',
  'sent',
  'failed',
  'skipped'
);

CREATE TYPE customer_payment_notification_type AS ENUM (
  'failed_payment'
);

CREATE TABLE customer_payment_notifications (
  id text PRIMARY KEY,
  mode mollie_mode NOT NULL,
  notification_type customer_payment_notification_type NOT NULL DEFAULT 'failed_payment',
  status customer_payment_notification_status NOT NULL DEFAULT 'claimed',
  customer_id text REFERENCES customers(id) ON DELETE SET NULL,
  payment_id text NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  subscription_id text REFERENCES subscriptions(id) ON DELETE SET NULL,
  recipient_email text,
  subject text,
  outcome_state text NOT NULL,
  outcome_reason text NOT NULL,
  template_version integer NOT NULL DEFAULT 1,
  attempt_count integer NOT NULL DEFAULT 0,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  failed_at timestamptz,
  last_error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_payment_notifications_mode_payment_type_key
    UNIQUE (mode, payment_id, notification_type)
);

CREATE INDEX customer_payment_notifications_status_idx
  ON customer_payment_notifications (status, created_at DESC);
