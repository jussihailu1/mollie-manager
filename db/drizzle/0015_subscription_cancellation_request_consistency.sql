ALTER TABLE "subscription_operation_requests"
  ADD CONSTRAINT "subscription_operation_requests_operator_reason_length_check"
  CHECK (length("operator_reason") <= 1000);--> statement-breakpoint
ALTER TABLE "subscription_operation_requests"
  ADD CONSTRAINT "subscription_operation_requests_cancellation_dates_check"
  CHECK (
    "operation" <> 'cancel'
    OR (
      "cancellation_effect" = 'immediate'
      AND "paid_period_end_at" IS NULL
    )
    OR (
      "cancellation_effect" = 'end_of_paid_period'
      AND "paid_period_end_at" IS NOT NULL
      AND "paid_period_end_at" >= "requested_effective_at"
    )
  );
