DROP INDEX IF EXISTS alerts_unresolved_title_entity_key;

CREATE UNIQUE INDEX alerts_unresolved_title_entity_tenant_key
  ON alerts (
    title,
    COALESCE(customer_id, ''),
    COALESCE(payment_id, ''),
    COALESCE(subscription_id, ''),
    COALESCE(payload ->> 'tenantId', '')
  )
  WHERE status IN ('open', 'acknowledged');
