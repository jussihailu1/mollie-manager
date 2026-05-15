DO $$ BEGIN
  CREATE TYPE recurring_billing_invoice_state AS ENUM (
    'pending_invoice',
    'invoice_created',
    'invoice_sent',
    'invoice_failed',
    'skipped',
    'canceled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS recurring_billing_schedules (
  id text PRIMARY KEY,
  subscription_id text NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  mode mollie_mode NOT NULL,
  planned_collection_date date NOT NULL,
  invoice_send_due_date date NOT NULL,
  invoice_notice_days_before_due_date integer NOT NULL DEFAULT 5,
  invoice_state recurring_billing_invoice_state NOT NULL DEFAULT 'pending_invoice',
  collection_state recurring_collection_state NOT NULL DEFAULT 'not_applicable',
  payment_id text REFERENCES payments(id) ON DELETE SET NULL,
  amount_value numeric(12, 2) NOT NULL,
  amount_currency char(3) NOT NULL,
  billing_period_index integer,
  eboekhouden_invoice_id text,
  eboekhouden_invoice_number text,
  invoice_created_at timestamptz,
  invoice_sent_at timestamptz,
  invoice_failed_at timestamptz,
  collection_resolved_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recurring_billing_schedules_subscription_date_key
    UNIQUE (subscription_id, planned_collection_date),
  CONSTRAINT recurring_billing_schedules_notice_days_check
    CHECK (invoice_notice_days_before_due_date > 0),
  CONSTRAINT recurring_billing_schedules_amount_value_check
    CHECK (amount_value >= 0)
);

CREATE INDEX IF NOT EXISTS recurring_billing_schedules_due_idx
  ON recurring_billing_schedules (mode, invoice_state, invoice_send_due_date);

CREATE INDEX IF NOT EXISTS recurring_billing_schedules_subscription_idx
  ON recurring_billing_schedules (subscription_id, planned_collection_date);
