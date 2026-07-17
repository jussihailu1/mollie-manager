CREATE TABLE IF NOT EXISTS "mollie_oauth_states" (
  "id" text PRIMARY KEY NOT NULL,
  "state_digest" text NOT NULL UNIQUE,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "actor_email" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mollie_oauth_states_tenant_expires_idx" ON "mollie_oauth_states" ("tenant_id", "expires_at" DESC);
