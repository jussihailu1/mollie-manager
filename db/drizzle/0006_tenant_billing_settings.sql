CREATE TYPE "public"."invoice_email_delivery_mode" AS ENUM(
  'app_smtp',
  'eboekhouden',
  'none'
);--> statement-breakpoint
CREATE TABLE "tenant_billing_settings" (
  "id" text PRIMARY KEY NOT NULL,
  "invoice_template_id" integer,
  "revenue_ledger_id" integer,
  "revenue_ledger_name" text DEFAULT 'Omzet abonnementen' NOT NULL,
  "vat_code" text DEFAULT 'HOOG_VERK_21' NOT NULL,
  "vat_percentage" numeric(5, 2) DEFAULT '21.00' NOT NULL,
  "invoice_line_description_source" text DEFAULT 'subscription_description' NOT NULL,
  "invoice_email_delivery_mode" "invoice_email_delivery_mode" DEFAULT 'app_smtp' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
