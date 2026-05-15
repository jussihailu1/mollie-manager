ALTER TYPE recurring_billing_invoice_state
  ADD VALUE IF NOT EXISTS 'invoice_creating'
  AFTER 'pending_invoice';
