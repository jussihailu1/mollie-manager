ALTER TABLE customers
  DROP CONSTRAINT IF EXISTS customers_mode_eboekhouden_relation_id_key;

DROP INDEX IF EXISTS customers_mode_eboekhouden_link_status_idx;

ALTER TABLE customers
  DROP COLUMN IF EXISTS eboekhouden_relation_id,
  DROP COLUMN IF EXISTS eboekhouden_relation_code,
  DROP COLUMN IF EXISTS eboekhouden_link_status,
  DROP COLUMN IF EXISTS eboekhouden_synced_at,
  DROP COLUMN IF EXISTS eboekhouden_relation_snapshot;

ALTER TABLE payments
  DROP COLUMN IF EXISTS eboekhouden_invoice_id,
  DROP COLUMN IF EXISTS eboekhouden_invoice_number;

ALTER TABLE recurring_billing_schedules
  DROP COLUMN IF EXISTS eboekhouden_invoice_id,
  DROP COLUMN IF EXISTS eboekhouden_invoice_number;

ALTER TABLE tenant_billing_settings
  DROP COLUMN IF EXISTS invoice_template_id,
  DROP COLUMN IF EXISTS revenue_ledger_id,
  DROP COLUMN IF EXISTS revenue_ledger_name;
