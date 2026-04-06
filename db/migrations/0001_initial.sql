DO $$ BEGIN
  CREATE TYPE mollie_mode AS ENUM ('test', 'live');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE subscription_lifecycle_state AS ENUM (
    'draft',
    'awaiting_first_payment',
    'mandate_pending',
    'active',
    'payment_action_required',
    'future_charges_stopped',
    'charged_back',
    'out_of_sync',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_lifecycle_type AS ENUM ('first', 'recurring', 'manual', 'refund');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE alert_severity AS ENUM ('info', 'warning', 'critical');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE alert_status AS ENUM ('open', 'acknowledged', 'resolved');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE audit_outcome AS ENUM ('success', 'failure');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE actor_kind AS ENUM ('user', 'system');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE webhook_processing_status AS ENUM ('pending', 'processed', 'failed', 'ignored');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS customers (
  id text PRIMARY KEY,
  mode mollie_mode NOT NULL,
  mollie_customer_id text,
  full_name text,
  email text NOT NULL,
  locale text NOT NULL DEFAULT 'nl_NL',
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz,
  UNIQUE (mode, mollie_customer_id)
);

CREATE TABLE IF NOT EXISTS mandates (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  mode mollie_mode NOT NULL,
  mollie_mandate_id text NOT NULL,
  method text,
  mollie_status text,
  is_valid boolean NOT NULL DEFAULT false,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz,
  UNIQUE (mode, mollie_mandate_id)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  mandate_id text REFERENCES mandates(id) ON DELETE SET NULL,
  mode mollie_mode NOT NULL,
  mollie_subscription_id text,
  local_status subscription_lifecycle_state NOT NULL DEFAULT 'draft',
  mollie_status text,
  description text NOT NULL,
  interval text NOT NULL,
  amount_value numeric(12, 2) NOT NULL CHECK (amount_value >= 0),
  amount_currency char(3) NOT NULL,
  billing_day integer,
  start_date date,
  stop_after_current_period boolean NOT NULL DEFAULT true,
  canceled_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz,
  UNIQUE (mode, mollie_subscription_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id text PRIMARY KEY,
  customer_id text REFERENCES customers(id) ON DELETE SET NULL,
  subscription_id text REFERENCES subscriptions(id) ON DELETE SET NULL,
  mandate_id text REFERENCES mandates(id) ON DELETE SET NULL,
  mode mollie_mode NOT NULL,
  payment_type payment_lifecycle_type NOT NULL,
  mollie_payment_id text,
  mollie_status text,
  sequence_type text,
  method text,
  amount_value numeric(12, 2) NOT NULL CHECK (amount_value >= 0),
  amount_currency char(3) NOT NULL,
  checkout_url text,
  expires_at timestamptz,
  paid_at timestamptz,
  failed_at timestamptz,
  disputed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz,
  UNIQUE (mode, mollie_payment_id)
);

CREATE TABLE IF NOT EXISTS payment_links (
  id text PRIMARY KEY,
  customer_id text REFERENCES customers(id) ON DELETE SET NULL,
  mode mollie_mode NOT NULL,
  mollie_payment_link_id text,
  mollie_status text,
  description text NOT NULL,
  amount_value numeric(12, 2) NOT NULL CHECK (amount_value >= 0),
  amount_currency char(3) NOT NULL,
  checkout_url text,
  expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz,
  UNIQUE (mode, mollie_payment_link_id)
);

CREATE TABLE IF NOT EXISTS alerts (
  id text PRIMARY KEY,
  severity alert_severity NOT NULL,
  status alert_status NOT NULL DEFAULT 'open',
  title text NOT NULL,
  message text NOT NULL,
  customer_id text REFERENCES customers(id) ON DELETE SET NULL,
  subscription_id text REFERENCES subscriptions(id) ON DELETE SET NULL,
  payment_id text REFERENCES payments(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  email_sent_at timestamptz,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id text PRIMARY KEY,
  actor_kind actor_kind NOT NULL,
  actor_email text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  mode mollie_mode,
  outcome audit_outcome NOT NULL,
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id text PRIMARY KEY,
  mode mollie_mode NOT NULL,
  webhook_source text NOT NULL DEFAULT 'mollie',
  resource_type text,
  resource_id text,
  topic text,
  request_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processing_status webhook_processing_status NOT NULL DEFAULT 'pending',
  error_message text,
  retry_count integer NOT NULL DEFAULT 0,
  received_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS customers_mode_email_idx ON customers (mode, email);
CREATE INDEX IF NOT EXISTS subscriptions_customer_idx ON subscriptions (customer_id, local_status);
CREATE INDEX IF NOT EXISTS payments_subscription_idx ON payments (subscription_id, payment_type);
CREATE INDEX IF NOT EXISTS payment_links_customer_idx ON payment_links (customer_id);
CREATE INDEX IF NOT EXISTS alerts_status_idx ON alerts (status, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_events_status_idx ON webhook_events (processing_status, received_at DESC);
