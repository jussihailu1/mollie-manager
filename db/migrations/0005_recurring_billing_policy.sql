DO $$ BEGIN
  CREATE TYPE recurring_collection_state AS ENUM (
    'not_applicable',
    'settled',
    'pending_return_window',
    'failed_needs_review',
    'mandate_problem_review',
    'reversal_critical_review'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS recurring_collection_state recurring_collection_state NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS collection_review_required_at timestamptz;

CREATE INDEX IF NOT EXISTS payments_recurring_collection_state_idx
  ON payments (payment_type, recurring_collection_state);
