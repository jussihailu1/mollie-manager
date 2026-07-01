ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS tenant_id text;

UPDATE webhook_events we
SET tenant_id = coalesce(
  (
    SELECT p.tenant_id
    FROM payments p
    WHERE p.mode = we.mode
      and p.mollie_payment_id = we.resource_id
    LIMIT 1
  ),
  (
    SELECT s.tenant_id
    FROM subscriptions s
    WHERE s.mode = we.mode
      and s.mollie_subscription_id = we.resource_id
    LIMIT 1
  ),
  (
    SELECT pl.tenant_id
    FROM payment_links pl
    WHERE pl.mode = we.mode
      and pl.mollie_payment_link_id = we.resource_id
    LIMIT 1
  )
)
WHERE we.tenant_id IS NULL;

DROP INDEX IF EXISTS webhook_events_status_idx;

ALTER TABLE webhook_events
  ADD CONSTRAINT webhook_events_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

CREATE INDEX webhook_events_tenant_status_idx
  ON webhook_events (tenant_id, processing_status, received_at DESC);
