ALTER TYPE invoice_provider ADD VALUE IF NOT EXISTS 'kify';

DO $$ BEGIN
  CREATE TYPE canonical_invoice_status AS ENUM ('number_reserved', 'render_pending', 'render_failed', 'issued', 'void');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE invoice_render_attempt_status AS ENUM ('claimed', 'rendered', 'stored', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS tenant_invoice_profiles (
  id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  legal_name text NOT NULL, trade_name text, street text NOT NULL, house_number text NOT NULL,
  house_number_addition text, postal_code text NOT NULL, city text NOT NULL, country_code char(2) NOT NULL,
  kvk_number text NOT NULL, vat_id text NOT NULL, invoice_email text NOT NULL, phone text, iban text, bic text,
  payment_term_days integer NOT NULL, invoice_prefix text NOT NULL, logo_artifact_locator text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_invoice_profiles_tenant_id_key UNIQUE (tenant_id),
  CONSTRAINT tenant_invoice_profiles_payment_term_days_check CHECK (payment_term_days >= 0),
  CONSTRAINT tenant_invoice_profiles_prefix_uppercase_check CHECK (invoice_prefix = upper(invoice_prefix))
);

CREATE TABLE IF NOT EXISTS customer_billing_profiles (
  id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE, legal_name text NOT NULL,
  contact_name text, street text NOT NULL, house_number text NOT NULL, house_number_addition text,
  postal_code text NOT NULL, city text NOT NULL, country_code char(2) NOT NULL, email text NOT NULL, vat_id text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_billing_profiles_tenant_customer_key UNIQUE (tenant_id, customer_id)
);

CREATE TABLE IF NOT EXISTS tenant_invoice_sequences (
  id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mode mollie_mode NOT NULL, year integer NOT NULL, prefix text NOT NULL, next_value integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_invoice_sequences_tenant_mode_year_prefix_key UNIQUE (tenant_id, mode, year, prefix),
  CONSTRAINT tenant_invoice_sequences_year_check CHECK (year >= 2000),
  CONSTRAINT tenant_invoice_sequences_next_value_check CHECK (next_value >= 1)
);

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS canonical_invoice_number text, ADD COLUMN IF NOT EXISTS canonical_status canonical_invoice_status,
  ADD COLUMN IF NOT EXISTS invoice_date date, ADD COLUMN IF NOT EXISTS due_date date, ADD COLUMN IF NOT EXISTS issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz, ADD COLUMN IF NOT EXISTS currency char(3), ADD COLUMN IF NOT EXISTS subtotal_cents integer,
  ADD COLUMN IF NOT EXISTS vat_cents integer, ADD COLUMN IF NOT EXISTS total_cents integer, ADD COLUMN IF NOT EXISTS amount_paid_cents integer,
  ADD COLUMN IF NOT EXISTS balance_cents integer, ADD COLUMN IF NOT EXISTS canonical_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS canonical_snapshot_sha256 text, ADD COLUMN IF NOT EXISTS void_reason text;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_tenant_mode_canonical_number_key ON invoices (tenant_id, mode, canonical_invoice_number) WHERE canonical_invoice_number IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE invoices ADD CONSTRAINT invoices_kify_canonical_snapshot_check CHECK (provider::text <> 'kify' OR (canonical_invoice_number IS NOT NULL AND canonical_status IS NOT NULL AND canonical_snapshot IS NOT NULL AND canonical_snapshot_sha256 IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS invoice_lines (
  id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id text NOT NULL REFERENCES invoices(id) ON DELETE CASCADE, position integer NOT NULL, description text NOT NULL,
  quantity numeric(12,3) NOT NULL, unit_gross_cents integer NOT NULL, net_cents integer NOT NULL,
  vat_rate_basis_points integer NOT NULL, vat_cents integer NOT NULL, gross_cents integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT invoice_lines_invoice_position_key UNIQUE (invoice_id, position),
  CONSTRAINT invoice_lines_position_check CHECK (position > 0), CONSTRAINT invoice_lines_positive_quantity_check CHECK (quantity > 0),
  CONSTRAINT invoice_lines_positive_gross_check CHECK (gross_cents > 0), CONSTRAINT invoice_lines_vat_sum_check CHECK (net_cents + vat_cents = gross_cents)
);

CREATE TABLE IF NOT EXISTS invoice_artifacts (
  id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id text NOT NULL REFERENCES invoices(id) ON DELETE CASCADE, format text NOT NULL, renderer_id text NOT NULL,
  storage_backend text NOT NULL, private_locator text NOT NULL, mime_type text NOT NULL, byte_size integer NOT NULL,
  sha256 text NOT NULL, snapshot_sha256 text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_artifacts_invoice_snapshot_pdf_key UNIQUE (invoice_id, snapshot_sha256, format),
  CONSTRAINT invoice_artifacts_private_locator_key UNIQUE (private_locator),
  CONSTRAINT invoice_artifacts_pdf_mime_check CHECK (format <> 'pdf' OR mime_type = 'application/pdf'),
  CONSTRAINT invoice_artifacts_byte_size_check CHECK (byte_size > 0)
);

CREATE TABLE IF NOT EXISTS invoice_render_attempts (
  id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id text NOT NULL REFERENCES invoices(id) ON DELETE CASCADE, renderer_id text NOT NULL,
  attempt_number integer NOT NULL, status invoice_render_attempt_status NOT NULL, safe_error_code text,
  artifact_id text REFERENCES invoice_artifacts(id) ON DELETE RESTRICT, snapshot_sha256 text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_render_attempts_invoice_attempt_number_key UNIQUE (invoice_id, attempt_number),
  CONSTRAINT invoice_render_attempts_number_check CHECK (attempt_number > 0)
);
