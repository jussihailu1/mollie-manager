CREATE TYPE "public"."recurring_billing_invoice_state" AS ENUM(
  'pending_invoice',
  'invoice_created',
  'invoice_sent',
  'invoice_failed',
  'skipped',
  'canceled'
);--> statement-breakpoint
CREATE TABLE "recurring_billing_schedules" (
  "id" text PRIMARY KEY NOT NULL,
  "subscription_id" text NOT NULL,
  "mode" "mollie_mode" NOT NULL,
  "planned_collection_date" date NOT NULL,
  "invoice_send_due_date" date NOT NULL,
  "invoice_notice_days_before_due_date" integer DEFAULT 5 NOT NULL,
  "invoice_state" "recurring_billing_invoice_state" DEFAULT 'pending_invoice' NOT NULL,
  "collection_state" "recurring_collection_state" DEFAULT 'not_applicable' NOT NULL,
  "payment_id" text,
  "amount_value" numeric(12, 2) NOT NULL,
  "amount_currency" char(3) NOT NULL,
  "billing_period_index" integer,
  "eboekhouden_invoice_id" text,
  "eboekhouden_invoice_number" text,
  "invoice_created_at" timestamp with time zone,
  "invoice_sent_at" timestamp with time zone,
  "invoice_failed_at" timestamp with time zone,
  "collection_resolved_at" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "recurring_billing_schedules_subscription_date_key" UNIQUE("subscription_id","planned_collection_date"),
  CONSTRAINT "recurring_billing_schedules_notice_days_check" CHECK ("recurring_billing_schedules"."invoice_notice_days_before_due_date" > 0),
  CONSTRAINT "recurring_billing_schedules_amount_value_check" CHECK ("recurring_billing_schedules"."amount_value" >= 0)
);
--> statement-breakpoint
ALTER TABLE "recurring_billing_schedules" ADD CONSTRAINT "recurring_billing_schedules_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_billing_schedules" ADD CONSTRAINT "recurring_billing_schedules_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recurring_billing_schedules_due_idx" ON "recurring_billing_schedules" USING btree ("mode","invoice_state","invoice_send_due_date");--> statement-breakpoint
CREATE INDEX "recurring_billing_schedules_subscription_idx" ON "recurring_billing_schedules" USING btree ("subscription_id","planned_collection_date");
