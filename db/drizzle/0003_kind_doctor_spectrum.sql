CREATE TYPE "public"."cancellation_effect" AS ENUM('immediate', 'end_of_paid_period');--> statement-breakpoint
CREATE TYPE "public"."first_payment_mode" AS ENUM('real_installment', 'mandate_only');--> statement-breakpoint
CREATE TYPE "public"."subscription_term_mode" AS ENUM('open_ended', 'fixed_term');--> statement-breakpoint
CREATE TABLE "subscription_onboarding_consents" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" "mollie_mode" NOT NULL,
	"customer_id" text NOT NULL,
	"payment_link_id" text NOT NULL,
	"consent_token" text NOT NULL,
	"first_payment_mode" "first_payment_mode" NOT NULL,
	"terms_version" text NOT NULL,
	"required_checkbox_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"accepted_checkbox_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"plan_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_ip" text,
	"accepted_user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_onboarding_consents_consent_token_key" UNIQUE("consent_token"),
	CONSTRAINT "subscription_onboarding_consents_mode_payment_link_id_key" UNIQUE("mode","payment_link_id")
);
--> statement-breakpoint
CREATE TABLE "tenant_subscription_policy_defaults" (
	"id" text PRIMARY KEY NOT NULL,
	"cancellation_email" text NOT NULL,
	"terms_url" text NOT NULL,
	"privacy_url" text NOT NULL,
	"terms_version" text NOT NULL,
	"default_cancellation_effect" "cancellation_effect" DEFAULT 'end_of_paid_period' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "subscription_term_mode" "subscription_term_mode" DEFAULT 'open_ended' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "total_payments" integer;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "last_charge_date" date;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "service_end_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "cancellation_effect" "cancellation_effect" DEFAULT 'end_of_paid_period' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_onboarding_consents" ADD CONSTRAINT "subscription_onboarding_consents_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_onboarding_consents" ADD CONSTRAINT "subscription_onboarding_consents_payment_link_id_fkey" FOREIGN KEY ("payment_link_id") REFERENCES "public"."payment_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscription_onboarding_consents_customer_idx" ON "subscription_onboarding_consents" USING btree ("customer_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_total_payments_positive_check" CHECK (
      "subscriptions"."total_payments" is null or "subscriptions"."total_payments" > 0
    );--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_term_mode_total_payments_check" CHECK (
      (
        "subscriptions"."subscription_term_mode" = 'fixed_term'
        and "subscriptions"."total_payments" is not null
      ) or (
        "subscriptions"."subscription_term_mode" = 'open_ended'
        and "subscriptions"."total_payments" is null
      )
    );
