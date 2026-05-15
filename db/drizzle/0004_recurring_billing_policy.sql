CREATE TYPE "public"."recurring_collection_state" AS ENUM(
  'not_applicable',
  'settled',
  'pending_return_window',
  'failed_needs_review',
  'mandate_problem_review',
  'reversal_critical_review'
);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "recurring_collection_state" "recurring_collection_state" DEFAULT 'not_applicable' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "collection_review_required_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "payments_recurring_collection_state_idx" ON "payments" USING btree ("payment_type","recurring_collection_state");
