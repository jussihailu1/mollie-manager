CREATE TYPE subscription_operation AS ENUM ('cancel', 'pause', 'resume');

CREATE TYPE subscription_operation_request_status AS ENUM (
  'pending',
  'scheduled',
  'processing',
  'applied',
  'failed',
  'withdrawn'
);

CREATE TABLE subscription_operation_requests (
  id text PRIMARY KEY,
  mode mollie_mode NOT NULL,
  subscription_id text NOT NULL,
  operation subscription_operation NOT NULL,
  status subscription_operation_request_status NOT NULL DEFAULT 'pending',
  operator_reason text NOT NULL,
  requested_effective_at timestamptz NOT NULL,
  paid_period_end_at timestamptz,
  cancellation_effect cancellation_effect NOT NULL,
  policy_reason_code text NOT NULL,
  provider_mutation_requirement text NOT NULL,
  requested_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  processing_at timestamptz,
  applied_at timestamptz,
  failed_at timestamptz,
  withdrawn_at timestamptz,
  CONSTRAINT subscription_operation_requests_subscription_id_fkey
    FOREIGN KEY (subscription_id)
    REFERENCES subscriptions(id)
    ON DELETE CASCADE,
  CONSTRAINT subscription_operation_requests_operator_reason_not_blank_check
    CHECK (length(btrim(operator_reason)) > 0)
);

CREATE UNIQUE INDEX subscription_operation_requests_unresolved_key
  ON subscription_operation_requests (subscription_id, operation)
  WHERE status IN ('pending', 'scheduled', 'processing');
