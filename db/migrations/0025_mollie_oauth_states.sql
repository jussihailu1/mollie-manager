CREATE TABLE IF NOT EXISTS mollie_oauth_states (
  id text PRIMARY KEY,
  state_digest text NOT NULL UNIQUE,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_email text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mollie_oauth_states_tenant_expires_idx
  ON mollie_oauth_states (tenant_id, expires_at DESC);
