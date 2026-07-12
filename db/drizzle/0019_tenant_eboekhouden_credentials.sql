CREATE TABLE IF NOT EXISTS "tenant_eboekhouden_credentials" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "api_source" text NOT NULL,
  "api_token_ciphertext" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tenant_eboekhouden_credentials_tenant_id_key" UNIQUE("tenant_id")
);
