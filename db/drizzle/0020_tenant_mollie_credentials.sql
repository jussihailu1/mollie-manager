CREATE TABLE IF NOT EXISTS "tenant_mollie_credentials" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "mode" "mollie_mode" NOT NULL,
  "api_key_ciphertext" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tenant_mollie_credentials_tenant_id_mode_key" UNIQUE("tenant_id","mode")
);
