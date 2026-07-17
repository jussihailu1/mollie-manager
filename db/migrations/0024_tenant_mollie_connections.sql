DO $$ BEGIN
  CREATE TYPE mollie_connection_status AS ENUM (
    'connected', 'incomplete', 'revoked', 'reconnect_required', 'disconnected'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS tenant_mollie_connections (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status mollie_connection_status NOT NULL,
  organization_id text,
  organization_name text,
  selected_profile_id text,
  selected_profile_name text,
  granted_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  refresh_token_ciphertext text,
  access_token_ciphertext text,
  access_token_expires_at timestamptz,
  credential_version integer NOT NULL DEFAULT 1,
  last_verified_at timestamptz,
  last_refreshed_at timestamptz,
  revoked_at timestamptz,
  disconnected_at timestamptz,
  failure_reason_code text,
  connected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

CREATE INDEX IF NOT EXISTS tenant_mollie_connections_status_idx
  ON tenant_mollie_connections (status);
