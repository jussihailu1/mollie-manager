CREATE TYPE "public"."subscription_operation" AS ENUM('cancel', 'pause', 'resume');--> statement-breakpoint
CREATE TYPE "public"."subscription_operation_request_status" AS ENUM('pending', 'scheduled', 'processing', 'applied', 'failed', 'withdrawn');--> statement-breakpoint
CREATE TABLE "subscription_operation_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" "mollie_mode" NOT NULL,
	"subscription_id" text NOT NULL,
	"operation" "subscription_operation" NOT NULL,
	"status" "subscription_operation_request_status" DEFAULT 'pending' NOT NULL,
	"operator_reason" text NOT NULL,
	"requested_effective_at" timestamp with time zone NOT NULL,
	"paid_period_end_at" timestamp with time zone,
	"cancellation_effect" "cancellation_effect" NOT NULL,
	"policy_reason_code" text NOT NULL,
	"provider_mutation_requirement" text NOT NULL,
	"requested_by_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processing_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "subscription_operation_requests_operator_reason_not_blank_check" CHECK (length(btrim("subscription_operation_requests"."operator_reason")) > 0)
);
--> statement-breakpoint
ALTER TABLE "subscription_operation_requests" ADD CONSTRAINT "subscription_operation_requests_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_operation_requests_unresolved_key" ON "subscription_operation_requests" USING btree ("subscription_id","operation") WHERE "subscription_operation_requests"."status" in ('pending', 'scheduled', 'processing');
