DO $$ BEGIN
  CREATE TYPE "mollie_connection_status" AS ENUM ('connected', 'incomplete', 'revoked', 'reconnect_required', 'disconnected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_mollie_connections" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "status" "mollie_connection_status" NOT NULL,
  "organization_id" text,
  "organization_name" text,
  "selected_profile_id" text,
  "selected_profile_name" text,
  "granted_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "refresh_token_ciphertext" text,
  "access_token_ciphertext" text,
  "access_token_expires_at" timestamptz,
  "credential_version" integer DEFAULT 1 NOT NULL,
  "last_verified_at" timestamptz,
  "last_refreshed_at" timestamptz,
  "revoked_at" timestamptz,
  "disconnected_at" timestamptz,
  "failure_reason_code" text,
  "connected_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "tenant_mollie_connections_tenant_id_key" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_mollie_connections_status_idx" ON "tenant_mollie_connections" ("status");
