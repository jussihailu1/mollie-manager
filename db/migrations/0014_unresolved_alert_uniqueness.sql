WITH ranked_unresolved_alerts AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY
        title,
        COALESCE(payment_id, ''),
        COALESCE(subscription_id, '')
      ORDER BY created_at, id
    ) AS duplicate_rank
  FROM alerts
  WHERE status IN ('open', 'acknowledged')
)
UPDATE alerts AS alert
SET
  status = 'resolved',
  resolved_at = COALESCE(alert.resolved_at, now()),
  updated_at = now()
FROM ranked_unresolved_alerts AS ranked
WHERE alert.id = ranked.id
  AND ranked.duplicate_rank > 1;

CREATE UNIQUE INDEX alerts_unresolved_title_entity_key
  ON alerts (
    title,
    COALESCE(payment_id, ''),
    COALESCE(subscription_id, '')
  )
  WHERE status IN ('open', 'acknowledged');
