CREATE TYPE "public"."customer_payment_notification_status" AS ENUM('claimed', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."customer_payment_notification_type" AS ENUM('failed_payment');--> statement-breakpoint
CREATE TABLE "customer_payment_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" "mollie_mode" NOT NULL,
	"notification_type" "customer_payment_notification_type" DEFAULT 'failed_payment' NOT NULL,
	"status" "customer_payment_notification_status" DEFAULT 'claimed' NOT NULL,
	"customer_id" text,
	"payment_id" text NOT NULL,
	"subscription_id" text,
	"recipient_email" text,
	"subject" text,
	"outcome_state" text NOT NULL,
	"outcome_reason" text NOT NULL,
	"template_version" integer DEFAULT 1 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_payment_notifications_mode_payment_type_key" UNIQUE("mode","payment_id","notification_type")
);
--> statement-breakpoint
ALTER TABLE "customer_payment_notifications" ADD CONSTRAINT "customer_payment_notifications_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payment_notifications" ADD CONSTRAINT "customer_payment_notifications_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payment_notifications" ADD CONSTRAINT "customer_payment_notifications_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_payment_notifications_status_idx" ON "customer_payment_notifications" USING btree ("status","created_at" DESC);
