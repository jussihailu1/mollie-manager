ALTER TABLE tenant_billing_settings
  ADD COLUMN tax_treatment text;
--> statement-breakpoint
ALTER TABLE tenant_billing_settings
  ADD CONSTRAINT tenant_billing_settings_tax_treatment_check
  CHECK (tax_treatment IN ('kor', 'standard'));
-- Existing VAT codes do not establish whether the issuer participates in KOR.
-- Leave existing tenants unset so invoice creation fails closed until confirmed.
