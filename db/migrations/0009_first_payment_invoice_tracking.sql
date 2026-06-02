DO $$ BEGIN
  CREATE TYPE payment_invoice_state AS ENUM (
    'not_applicable',
    'pending_invoice',
    'invoice_creating',
    'invoice_created',
    'invoice_sent',
    'invoice_failed',
    'skipped'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS invoice_state payment_invoice_state NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS eboekhouden_invoice_id text,
  ADD COLUMN IF NOT EXISTS eboekhouden_invoice_number text,
  ADD COLUMN IF NOT EXISTS invoice_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_failed_at timestamptz;

CREATE INDEX IF NOT EXISTS payments_invoice_state_idx
  ON payments (mode, payment_type, invoice_state);

WITH consent_matches AS (
  SELECT
    p.id AS payment_id,
    count(*) AS match_count,
    max(CASE WHEN soc.accepted_at IS NOT NULL THEN 1 ELSE 0 END) AS has_accepted_consent,
    min(soc.first_payment_mode::text) AS min_first_payment_mode,
    max(soc.first_payment_mode::text) AS max_first_payment_mode
  FROM payments p
  INNER JOIN payment_links pl
    ON pl.mode = p.mode
    AND pl.metadata ->> 'source' = 'subscription_onboarding'
    AND pl.metadata ->> 'paymentType' = 'first'
    AND (
      pl.metadata ->> 'latestPaymentId' = p.mollie_payment_id
      OR coalesce(pl.metadata -> 'paymentIds', '[]'::jsonb) ? p.mollie_payment_id
    )
  INNER JOIN subscription_onboarding_consents soc
    ON soc.mode = p.mode
    AND soc.payment_link_id = pl.id
  WHERE p.payment_type = 'first'
    AND p.mollie_payment_id IS NOT NULL
  GROUP BY p.id
),
normalized_targets AS (
  SELECT
    p.id AS payment_id,
    CASE
      WHEN cm.match_count = 1
        AND cm.has_accepted_consent = 1
        AND cm.min_first_payment_mode = cm.max_first_payment_mode
        AND cm.max_first_payment_mode = 'mandate_only'
      THEN 'skipped'::payment_invoice_state
      WHEN cm.match_count = 1
        AND cm.has_accepted_consent = 1
        AND cm.min_first_payment_mode = cm.max_first_payment_mode
        AND cm.max_first_payment_mode = 'real_installment'
        AND p.mollie_status = 'paid'
      THEN 'pending_invoice'::payment_invoice_state
      ELSE 'not_applicable'::payment_invoice_state
    END AS invoice_state
  FROM payments p
  LEFT JOIN consent_matches cm ON cm.payment_id = p.id
  WHERE p.payment_type = 'first'
)
UPDATE payments p
SET
  invoice_state = nt.invoice_state,
  updated_at = now()
FROM normalized_targets nt
WHERE p.id = nt.payment_id
  AND p.payment_type = 'first'
  AND p.invoice_state = 'not_applicable';
