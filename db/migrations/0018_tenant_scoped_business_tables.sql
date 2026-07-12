INSERT INTO tenants (
  id,
  slug,
  name,
  created_at,
  updated_at
) VALUES (
  'legacy-default',
  'legacy-default',
  'Legacy Default Tenant',
  now(),
  now()
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS tenant_id text;

UPDATE customers
SET tenant_id = 'legacy-default'
WHERE tenant_id IS NULL;

ALTER TABLE customers
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE customers
  DROP CONSTRAINT IF EXISTS customers_mode_mollie_customer_id_key;

ALTER TABLE customers
  DROP CONSTRAINT IF EXISTS customers_mode_eboekhouden_relation_id_key;

DROP INDEX IF EXISTS customers_mode_email_idx;
DROP INDEX IF EXISTS customers_mode_archived_at_idx;
DROP INDEX IF EXISTS customers_mode_eboekhouden_link_status_idx;

ALTER TABLE customers
  ADD CONSTRAINT customers_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE customers
  ADD CONSTRAINT customers_mode_mollie_customer_id_key
  UNIQUE (tenant_id, mode, mollie_customer_id);

ALTER TABLE customers
  ADD CONSTRAINT customers_mode_eboekhouden_relation_id_key
  UNIQUE (tenant_id, mode, eboekhouden_relation_id);

CREATE INDEX customers_tenant_mode_email_idx
  ON customers (tenant_id, mode, email);

CREATE INDEX customers_tenant_mode_archived_at_idx
  ON customers (tenant_id, mode, archived_at);

CREATE INDEX customers_mode_eboekhouden_link_status_idx
  ON customers (tenant_id, mode, eboekhouden_link_status);

ALTER TABLE mandates
  ADD COLUMN IF NOT EXISTS tenant_id text;

UPDATE mandates m
SET tenant_id = coalesce(
  (
    SELECT c.tenant_id
    FROM customers c
    WHERE c.id = m.customer_id
    LIMIT 1
  ),
  'legacy-default'
)
WHERE m.tenant_id IS NULL;

UPDATE mandates
SET tenant_id = 'legacy-default'
WHERE tenant_id IS NULL;

ALTER TABLE mandates
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE mandates
  DROP CONSTRAINT IF EXISTS mandates_mode_mollie_mandate_id_key;

ALTER TABLE mandates
  ADD CONSTRAINT mandates_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE mandates
  ADD CONSTRAINT mandates_mode_mollie_mandate_id_key
  UNIQUE (tenant_id, mode, mollie_mandate_id);

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS tenant_id text;

UPDATE subscriptions s
SET tenant_id = coalesce(
  (
    SELECT c.tenant_id
    FROM customers c
    WHERE c.id = s.customer_id
    LIMIT 1
  ),
  'legacy-default'
)
WHERE s.tenant_id IS NULL;

UPDATE subscriptions
SET tenant_id = 'legacy-default'
WHERE tenant_id IS NULL;

ALTER TABLE subscriptions
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_mode_mollie_subscription_id_key;

DROP INDEX IF EXISTS subscriptions_customer_idx;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_mode_mollie_subscription_id_key
  UNIQUE (tenant_id, mode, mollie_subscription_id);

CREATE INDEX subscriptions_tenant_customer_idx
  ON subscriptions (tenant_id, customer_id, local_status);

ALTER TABLE subscription_operation_requests
  ADD COLUMN IF NOT EXISTS tenant_id text;

UPDATE subscription_operation_requests sor
SET tenant_id = coalesce(
  (
    SELECT s.tenant_id
    FROM subscriptions s
    WHERE s.id = sor.subscription_id
    LIMIT 1
  ),
  'legacy-default'
)
WHERE sor.tenant_id IS NULL;

UPDATE subscription_operation_requests
SET tenant_id = 'legacy-default'
WHERE tenant_id IS NULL;

ALTER TABLE subscription_operation_requests
  ALTER COLUMN tenant_id SET NOT NULL;

DROP INDEX IF EXISTS subscription_operation_requests_unresolved_key;

ALTER TABLE subscription_operation_requests
  ADD CONSTRAINT subscription_operation_requests_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX subscription_operation_requests_unresolved_key
  ON subscription_operation_requests (tenant_id, subscription_id, operation)
  WHERE status in ('pending', 'scheduled', 'processing');

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS tenant_id text;

UPDATE payments p
SET tenant_id = coalesce(
  (
    SELECT c.tenant_id
    FROM customers c
    WHERE c.id = p.customer_id
    LIMIT 1
  ),
  (
    SELECT s.tenant_id
    FROM subscriptions s
    WHERE s.id = p.subscription_id
    LIMIT 1
  ),
  (
    SELECT m.tenant_id
    FROM mandates m
    WHERE m.id = p.mandate_id
    LIMIT 1
  ),
  'legacy-default'
)
WHERE p.tenant_id IS NULL;

UPDATE payments
SET tenant_id = 'legacy-default'
WHERE tenant_id IS NULL;

ALTER TABLE payments
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_mode_mollie_payment_id_key;

DROP INDEX IF EXISTS payments_subscription_idx;
DROP INDEX IF EXISTS payments_recurring_collection_state_idx;
DROP INDEX IF EXISTS payments_invoice_state_idx;

ALTER TABLE payments
  ADD CONSTRAINT payments_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE payments
  ADD CONSTRAINT payments_mode_mollie_payment_id_key
  UNIQUE (tenant_id, mode, mollie_payment_id);

CREATE INDEX payments_tenant_subscription_idx
  ON payments (tenant_id, subscription_id, payment_type);

CREATE INDEX payments_tenant_recurring_collection_state_idx
  ON payments (tenant_id, payment_type, recurring_collection_state);

CREATE INDEX payments_tenant_invoice_state_idx
  ON payments (tenant_id, mode, payment_type, invoice_state);

ALTER TABLE recurring_billing_schedules
  ADD COLUMN IF NOT EXISTS tenant_id text;

UPDATE recurring_billing_schedules rbs
SET tenant_id = coalesce(
  (
    SELECT s.tenant_id
    FROM subscriptions s
    WHERE s.id = rbs.subscription_id
    LIMIT 1
  ),
  (
    SELECT p.tenant_id
    FROM payments p
    WHERE p.id = rbs.payment_id
    LIMIT 1
  ),
  'legacy-default'
)
WHERE rbs.tenant_id IS NULL;

UPDATE recurring_billing_schedules
SET tenant_id = 'legacy-default'
WHERE tenant_id IS NULL;

ALTER TABLE recurring_billing_schedules
  ALTER COLUMN tenant_id SET NOT NULL;

DROP INDEX IF EXISTS recurring_billing_schedules_due_idx;
DROP INDEX IF EXISTS recurring_billing_schedules_subscription_idx;

ALTER TABLE recurring_billing_schedules
  ADD CONSTRAINT recurring_billing_schedules_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

CREATE INDEX recurring_billing_schedules_tenant_due_idx
  ON recurring_billing_schedules (tenant_id, mode, invoice_state, invoice_send_due_date);

CREATE INDEX recurring_billing_schedules_tenant_subscription_idx
  ON recurring_billing_schedules (tenant_id, subscription_id, planned_collection_date);

ALTER TABLE payment_links
  ADD COLUMN IF NOT EXISTS tenant_id text;

UPDATE payment_links pl
SET tenant_id = coalesce(
  (
    SELECT c.tenant_id
    FROM customers c
    WHERE c.id = pl.customer_id
    LIMIT 1
  ),
  'legacy-default'
)
WHERE pl.tenant_id IS NULL;

UPDATE payment_links
SET tenant_id = 'legacy-default'
WHERE tenant_id IS NULL;

ALTER TABLE payment_links
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE payment_links
  DROP CONSTRAINT IF EXISTS payment_links_mode_mollie_payment_link_id_key;

DROP INDEX IF EXISTS payment_links_customer_idx;

ALTER TABLE payment_links
  ADD CONSTRAINT payment_links_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE payment_links
  ADD CONSTRAINT payment_links_mode_mollie_payment_link_id_key
  UNIQUE (tenant_id, mode, mollie_payment_link_id);

CREATE INDEX payment_links_tenant_customer_idx
  ON payment_links (tenant_id, customer_id);

ALTER TABLE subscription_onboarding_consents
  ADD COLUMN IF NOT EXISTS tenant_id text;

UPDATE subscription_onboarding_consents soc
SET tenant_id = coalesce(
  (
    SELECT c.tenant_id
    FROM customers c
    WHERE c.id = soc.customer_id
    LIMIT 1
  ),
  (
    SELECT pl.tenant_id
    FROM payment_links pl
    WHERE pl.id = soc.payment_link_id
    LIMIT 1
  ),
  'legacy-default'
)
WHERE soc.tenant_id IS NULL;

UPDATE subscription_onboarding_consents
SET tenant_id = 'legacy-default'
WHERE tenant_id IS NULL;

ALTER TABLE subscription_onboarding_consents
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE subscription_onboarding_consents
  DROP CONSTRAINT IF EXISTS subscription_onboarding_consents_mode_payment_link_id_key;

DROP INDEX IF EXISTS subscription_onboarding_consents_customer_idx;

ALTER TABLE subscription_onboarding_consents
  ADD CONSTRAINT subscription_onboarding_consents_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE subscription_onboarding_consents
  ADD CONSTRAINT subscription_onboarding_consents_mode_payment_link_id_key
  UNIQUE (tenant_id, mode, payment_link_id);

CREATE INDEX subscription_onboarding_consents_tenant_customer_idx
  ON subscription_onboarding_consents (tenant_id, customer_id, created_at desc nulls last);

ALTER TABLE customer_notes
  ADD COLUMN IF NOT EXISTS tenant_id text;

UPDATE customer_notes cn
SET tenant_id = coalesce(
  (
    SELECT c.tenant_id
    FROM customers c
    WHERE c.id = cn.customer_id
    LIMIT 1
  ),
  'legacy-default'
)
WHERE cn.tenant_id IS NULL;

UPDATE customer_notes
SET tenant_id = 'legacy-default'
WHERE tenant_id IS NULL;

ALTER TABLE customer_notes
  ALTER COLUMN tenant_id SET NOT NULL;

DROP INDEX IF EXISTS customer_notes_customer_created_idx;

ALTER TABLE customer_notes
  ADD CONSTRAINT customer_notes_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

CREATE INDEX customer_notes_tenant_customer_created_idx
  ON customer_notes (tenant_id, customer_id, created_at desc nulls last);
