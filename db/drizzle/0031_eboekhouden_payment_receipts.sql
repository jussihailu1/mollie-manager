ALTER TABLE "invoices" ADD CONSTRAINT "invoices_receipt_owner_key" UNIQUE("tenant_id","mode","id");
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_receipt_owner_key" UNIQUE("tenant_id","mode","id","mollie_payment_id");
--> statement-breakpoint
CREATE TABLE "eboekhouden_payment_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"mode" "mollie_mode" NOT NULL,
	"payment_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"mollie_payment_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"clearing_ledger_id" integer NOT NULL,
	"credential_version" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"invoice_snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'prepared' NOT NULL,
	"attempted_at" timestamp with time zone,
	"mutation_id" integer,
	"claim_token" text,
	"claimed_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_payment_key" UNIQUE("tenant_id","mode","payment_id"),
	CONSTRAINT "receipts_invoice_key" UNIQUE("tenant_id","mode","invoice_id"),
	CONSTRAINT "receipts_mollie_payment_key" UNIQUE("tenant_id","mode","mollie_payment_id"),
	CONSTRAINT "receipts_mutation_key" UNIQUE("tenant_id","mode","mutation_id"),
	CONSTRAINT "receipts_live_check" CHECK ("eboekhouden_payment_receipts"."mode" = 'live'),
	CONSTRAINT "receipts_state_check" CHECK ("eboekhouden_payment_receipts"."status" in ('prepared', 'posting', 'verified', 'review_required')),
	CONSTRAINT "receipts_attempt_check" CHECK (("eboekhouden_payment_receipts"."status" <> 'prepared' or "eboekhouden_payment_receipts"."attempted_at" is null) and ("eboekhouden_payment_receipts"."status" <> 'posting' or "eboekhouden_payment_receipts"."attempted_at" is not null)),
	CONSTRAINT "receipts_verified_check" CHECK (("eboekhouden_payment_receipts"."status" = 'verified') = ("eboekhouden_payment_receipts"."mutation_id" is not null)),
	CONSTRAINT "receipts_positive_ids_check" CHECK ("eboekhouden_payment_receipts"."clearing_ledger_id" > 0 and ("eboekhouden_payment_receipts"."mutation_id" is null or "eboekhouden_payment_receipts"."mutation_id" > 0)),
	CONSTRAINT "receipts_evidence_check" CHECK (jsonb_typeof("eboekhouden_payment_receipts"."payload") = 'object' and jsonb_typeof("eboekhouden_payment_receipts"."invoice_snapshot") = 'object'),
	CONSTRAINT "receipts_error_code_check" CHECK ("eboekhouden_payment_receipts"."error_code" is null or "eboekhouden_payment_receipts"."error_code" ~ '^[A-Za-z][A-Za-z0-9_]{0,79}$')
);

--> statement-breakpoint
CREATE TABLE "tenant_eboekhouden_receipt_settings" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"mode" "mollie_mode" DEFAULT 'live' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"profile_id" text NOT NULL,
	"clearing_ledger_id" integer NOT NULL,
	"payments_from" timestamp with time zone NOT NULL,
	"credential_version" timestamp with time zone NOT NULL,
	"cursor_payment_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_settings_tenant_mode_key" UNIQUE("tenant_id","mode"),
	CONSTRAINT "receipt_settings_live_check" CHECK ("tenant_eboekhouden_receipt_settings"."mode" = 'live'),
	CONSTRAINT "receipt_settings_ledger_check" CHECK ("tenant_eboekhouden_receipt_settings"."clearing_ledger_id" > 0),
	CONSTRAINT "receipt_settings_profile_check" CHECK ("tenant_eboekhouden_receipt_settings"."profile_id" ~ '^pfl_[A-Za-z0-9]+$')
);

--> statement-breakpoint
ALTER TABLE "eboekhouden_payment_receipts" ADD CONSTRAINT "receipts_settings_fkey" FOREIGN KEY ("tenant_id","mode") REFERENCES "public"."tenant_eboekhouden_receipt_settings"("tenant_id","mode") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "eboekhouden_payment_receipts" ADD CONSTRAINT "receipts_payment_owner_fkey" FOREIGN KEY ("tenant_id","mode","payment_id","mollie_payment_id") REFERENCES "public"."payments"("tenant_id","mode","id","mollie_payment_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "eboekhouden_payment_receipts" ADD CONSTRAINT "receipts_invoice_owner_fkey" FOREIGN KEY ("tenant_id","mode","invoice_id") REFERENCES "public"."invoices"("tenant_id","mode","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tenant_eboekhouden_receipt_settings" ADD CONSTRAINT "receipt_settings_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "receipts_claim_idx" ON "eboekhouden_payment_receipts" USING btree ("tenant_id","mode","status","claimed_at");
