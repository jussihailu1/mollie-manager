DO $$ BEGIN
  CREATE TYPE invoice_email_delivery_mode AS ENUM (
    'app_smtp',
    'eboekhouden',
    'none'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS tenant_billing_settings (
  id text PRIMARY KEY,
  invoice_template_id integer,
  revenue_ledger_id integer,
  revenue_ledger_name text NOT NULL DEFAULT 'Omzet abonnementen',
  vat_code text NOT NULL DEFAULT 'HOOG_VERK_21',
  vat_percentage numeric(5, 2) NOT NULL DEFAULT '21.00',
  invoice_line_description_source text NOT NULL DEFAULT 'subscription_description',
  invoice_email_delivery_mode invoice_email_delivery_mode NOT NULL DEFAULT 'app_smtp',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
