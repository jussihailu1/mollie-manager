ALTER TABLE webhook_events ALTER COLUMN mode DROP NOT NULL;

UPDATE webhook_events SET mode = NULL
WHERE tenant_id IS NULL AND processing_status = 'failed'
  AND error_message = 'Webhook is not linked to a managed local resource.';
