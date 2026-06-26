CREATE TABLE IF NOT EXISTS tenants (
  id text PRIMARY KEY,
  slug text NOT NULL,
  name text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT tenants_slug_key UNIQUE (slug)
);

CREATE TABLE IF NOT EXISTS platform_operators (
  id text PRIMARY KEY,
  operator_email text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT platform_operators_operator_email_key UNIQUE (operator_email)
);

CREATE TABLE IF NOT EXISTS operator_tenant_memberships (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  operator_email text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT operator_tenant_memberships_tenant_email_key UNIQUE (tenant_id, operator_email)
);

CREATE INDEX IF NOT EXISTS operator_tenant_memberships_email_idx
  ON operator_tenant_memberships (operator_email);

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

ALTER TABLE tenant_subscription_policy_defaults
  ADD COLUMN IF NOT EXISTS tenant_id text;

UPDATE tenant_subscription_policy_defaults
SET tenant_id = 'legacy-default'
WHERE tenant_id IS NULL;

ALTER TABLE tenant_subscription_policy_defaults
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE tenant_subscription_policy_defaults
  ADD CONSTRAINT tenant_subscription_policy_defaults_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE tenant_subscription_policy_defaults
  ADD CONSTRAINT tenant_subscription_policy_defaults_tenant_id_key
  UNIQUE (tenant_id);

ALTER TABLE tenant_billing_settings
  ADD COLUMN IF NOT EXISTS tenant_id text;

UPDATE tenant_billing_settings
SET tenant_id = 'legacy-default'
WHERE tenant_id IS NULL;

ALTER TABLE tenant_billing_settings
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE tenant_billing_settings
  ADD CONSTRAINT tenant_billing_settings_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE tenant_billing_settings
  ADD CONSTRAINT tenant_billing_settings_tenant_id_key
  UNIQUE (tenant_id);
