DO $$
BEGIN
  CREATE TYPE customer_accounting_link_status AS ENUM (
    'linked',
    'unlinked',
    'needs_review',
    'sync_error'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE invoice_provider AS ENUM ('eboekhouden', 'mollie');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE invoice_owner_type AS ENUM ('payment', 'recurring_schedule');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE tenant_billing_settings
  ADD COLUMN IF NOT EXISTS active_invoice_provider invoice_provider;

UPDATE tenant_billing_settings tbs
SET active_invoice_provider = CASE
  WHEN EXISTS (
    SELECT 1
    FROM tenant_eboekhouden_credentials tec
    WHERE tec.tenant_id = tbs.tenant_id
  ) THEN 'eboekhouden'::invoice_provider
  WHEN EXISTS (
    SELECT 1
    FROM payments p
    WHERE p.tenant_id = tbs.tenant_id
      AND (
        p.eboekhouden_invoice_id IS NOT NULL
        OR p.eboekhouden_invoice_number IS NOT NULL
      )
  ) THEN 'eboekhouden'::invoice_provider
  WHEN EXISTS (
    SELECT 1
    FROM recurring_billing_schedules rbs
    WHERE rbs.tenant_id = tbs.tenant_id
      AND (
        rbs.eboekhouden_invoice_id IS NOT NULL
        OR rbs.eboekhouden_invoice_number IS NOT NULL
      )
  ) THEN 'eboekhouden'::invoice_provider
  ELSE 'mollie'::invoice_provider
END
WHERE tbs.active_invoice_provider IS NULL;

ALTER TABLE tenant_billing_settings
  ALTER COLUMN active_invoice_provider SET DEFAULT 'mollie';

ALTER TABLE tenant_billing_settings
  ALTER COLUMN active_invoice_provider SET NOT NULL;

CREATE TABLE IF NOT EXISTS tenant_eboekhouden_invoice_settings (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_template_id integer,
  revenue_ledger_id integer,
  revenue_ledger_name text NOT NULL DEFAULT 'Omzet abonnementen',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT tenant_eboekhouden_invoice_settings_tenant_id_key UNIQUE (tenant_id)
);

INSERT INTO tenant_eboekhouden_invoice_settings (
  id,
  tenant_id,
  invoice_template_id,
  revenue_ledger_id,
  revenue_ledger_name,
  created_at,
  updated_at
)
SELECT
  tenant_id,
  tenant_id,
  invoice_template_id,
  revenue_ledger_id,
  COALESCE(revenue_ledger_name, 'Omzet abonnementen'),
  now(),
  now()
FROM tenant_billing_settings
ON CONFLICT (tenant_id) DO UPDATE SET
  invoice_template_id = EXCLUDED.invoice_template_id,
  revenue_ledger_id = EXCLUDED.revenue_ledger_id,
  revenue_ledger_name = EXCLUDED.revenue_ledger_name,
  updated_at = now();

CREATE TABLE IF NOT EXISTS customer_accounting_links (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  mode mollie_mode NOT NULL,
  provider invoice_provider NOT NULL,
  provider_customer_id text,
  provider_customer_code text,
  link_status customer_accounting_link_status NOT NULL DEFAULT 'unlinked',
  synced_at timestamp with time zone,
  provider_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT customer_accounting_links_customer_provider_key
    UNIQUE (tenant_id, customer_id, mode, provider)
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_accounting_links_provider_customer_id_key
  ON customer_accounting_links (tenant_id, mode, provider, provider_customer_id);

CREATE INDEX IF NOT EXISTS customer_accounting_links_status_idx
  ON customer_accounting_links (tenant_id, mode, provider, link_status);

INSERT INTO customer_accounting_links (
  id,
  tenant_id,
  customer_id,
  mode,
  provider,
  provider_customer_id,
  provider_customer_code,
  link_status,
  synced_at,
  provider_snapshot,
  created_at,
  updated_at
)
SELECT
  concat('eboekhouden:', c.id, ':', c.mode),
  c.tenant_id,
  c.id,
  c.mode,
  'eboekhouden'::invoice_provider,
  CASE
    WHEN c.eboekhouden_relation_id IS NULL THEN NULL
    ELSE c.eboekhouden_relation_id::text
  END,
  c.eboekhouden_relation_code,
  CASE c.eboekhouden_link_status::text
    WHEN 'linked' THEN 'linked'::customer_accounting_link_status
    WHEN 'needs_review' THEN 'needs_review'::customer_accounting_link_status
    WHEN 'sync_error' THEN 'sync_error'::customer_accounting_link_status
    ELSE 'unlinked'::customer_accounting_link_status
  END,
  c.eboekhouden_synced_at,
  COALESCE(c.eboekhouden_relation_snapshot, '{}'::jsonb),
  c.created_at,
  c.updated_at
FROM customers c
ON CONFLICT (tenant_id, customer_id, mode, provider) DO UPDATE SET
  provider_customer_id = EXCLUDED.provider_customer_id,
  provider_customer_code = EXCLUDED.provider_customer_code,
  link_status = EXCLUDED.link_status,
  synced_at = EXCLUDED.synced_at,
  provider_snapshot = EXCLUDED.provider_snapshot,
  updated_at = now();

CREATE TABLE IF NOT EXISTS invoices (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mode mollie_mode NOT NULL,
  owner_type invoice_owner_type NOT NULL,
  owner_id text NOT NULL,
  provider invoice_provider NOT NULL,
  provider_invoice_id text,
  provider_invoice_number text,
  provider_customer_id text,
  provider_document_url text,
  provider_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT invoices_owner_key UNIQUE (tenant_id, owner_type, owner_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS invoices_provider_invoice_id_key
  ON invoices (tenant_id, mode, provider, provider_invoice_id);

CREATE INDEX IF NOT EXISTS invoices_provider_invoice_number_idx
  ON invoices (tenant_id, mode, provider, provider_invoice_number);

INSERT INTO invoices (
  id,
  tenant_id,
  mode,
  owner_type,
  owner_id,
  provider,
  provider_invoice_id,
  provider_invoice_number,
  provider_customer_id,
  provider_document_url,
  provider_snapshot,
  synced_at,
  created_at,
  updated_at
)
SELECT
  concat('payment:', p.id),
  p.tenant_id,
  p.mode,
  'payment'::invoice_owner_type,
  p.id,
  'eboekhouden'::invoice_provider,
  p.eboekhouden_invoice_id,
  p.eboekhouden_invoice_number,
  cal.provider_customer_id,
  COALESCE(
    NULLIF(p.metadata ->> 'invoiceDocumentUrl', ''),
    NULLIF(p.metadata #>> '{eboekhoudenInvoice,urlPdfFile}', '')
  ),
  COALESCE(p.metadata -> 'eboekhoudenInvoice', '{}'::jsonb),
  p.invoice_sent_at,
  COALESCE(p.invoice_created_at, p.created_at),
  now()
FROM payments p
LEFT JOIN customer_accounting_links cal
  ON cal.customer_id = p.customer_id
  AND cal.tenant_id = p.tenant_id
  AND cal.mode = p.mode
  AND cal.provider = 'eboekhouden'
WHERE p.eboekhouden_invoice_id IS NOT NULL
   OR p.eboekhouden_invoice_number IS NOT NULL
ON CONFLICT (tenant_id, owner_type, owner_id) DO UPDATE SET
  provider_invoice_id = EXCLUDED.provider_invoice_id,
  provider_invoice_number = EXCLUDED.provider_invoice_number,
  provider_customer_id = EXCLUDED.provider_customer_id,
  provider_document_url = EXCLUDED.provider_document_url,
  provider_snapshot = EXCLUDED.provider_snapshot,
  synced_at = EXCLUDED.synced_at,
  updated_at = now();

INSERT INTO invoices (
  id,
  tenant_id,
  mode,
  owner_type,
  owner_id,
  provider,
  provider_invoice_id,
  provider_invoice_number,
  provider_customer_id,
  provider_document_url,
  provider_snapshot,
  synced_at,
  created_at,
  updated_at
)
SELECT
  concat('schedule:', rbs.id),
  rbs.tenant_id,
  rbs.mode,
  'recurring_schedule'::invoice_owner_type,
  rbs.id,
  'eboekhouden'::invoice_provider,
  rbs.eboekhouden_invoice_id,
  rbs.eboekhouden_invoice_number,
  cal.provider_customer_id,
  COALESCE(
    NULLIF(rbs.metadata ->> 'invoiceDocumentUrl', ''),
    NULLIF(rbs.metadata #>> '{eboekhoudenInvoice,urlPdfFile}', '')
  ),
  COALESCE(rbs.metadata -> 'eboekhoudenInvoice', '{}'::jsonb),
  rbs.invoice_sent_at,
  COALESCE(rbs.invoice_created_at, rbs.created_at),
  now()
FROM recurring_billing_schedules rbs
INNER JOIN subscriptions s
  ON s.id = rbs.subscription_id
  AND s.tenant_id = rbs.tenant_id
LEFT JOIN customer_accounting_links cal
  ON cal.customer_id = s.customer_id
  AND cal.tenant_id = rbs.tenant_id
  AND cal.mode = rbs.mode
  AND cal.provider = 'eboekhouden'
WHERE rbs.eboekhouden_invoice_id IS NOT NULL
   OR rbs.eboekhouden_invoice_number IS NOT NULL
ON CONFLICT (tenant_id, owner_type, owner_id) DO UPDATE SET
  provider_invoice_id = EXCLUDED.provider_invoice_id,
  provider_invoice_number = EXCLUDED.provider_invoice_number,
  provider_customer_id = EXCLUDED.provider_customer_id,
  provider_document_url = EXCLUDED.provider_document_url,
  provider_snapshot = EXCLUDED.provider_snapshot,
  synced_at = EXCLUDED.synced_at,
  updated_at = now();
