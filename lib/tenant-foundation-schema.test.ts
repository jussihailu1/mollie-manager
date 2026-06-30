import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("tenant foundation schema", () => {
  const schemaSource = readFileSync(resolve("db/schema.ts"), "utf8");
  const migrationSources = [
    "db/migrations/0017_tenant_foundation.sql",
    "db/drizzle/0016_tenant_foundation.sql",
  ].map((path) => readFileSync(resolve(path), "utf8"));

  it("defines tenant, platform operator, and membership tables", () => {
    assert.match(schemaSource, /export const tenants = pgTable/);
    assert.match(schemaSource, /export const platformOperators = pgTable/);
    assert.match(schemaSource, /export const operatorTenantMemberships = pgTable/);
  });

  it("makes tenant policy and billing rows tenant-owned", () => {
    assert.match(schemaSource, /tenant_subscription_policy_defaults[\s\S]*tenantId: text\("tenant_id"\)/);
    assert.match(schemaSource, /tenant_billing_settings[\s\S]*tenantId: text\("tenant_id"\)/);
    assert.match(schemaSource, /tenant_eboekhouden_credentials[\s\S]*tenantId: text\("tenant_id"\)/);
    assert.match(schemaSource, /tenant_subscription_policy_defaults_tenant_id_key/);
    assert.match(schemaSource, /tenant_billing_settings_tenant_id_key/);
    assert.match(schemaSource, /tenant_eboekhouden_credentials_tenant_id_key/);
  });

  it("tenantizes core customer-linked business tables", () => {
    assert.match(schemaSource, /export const customers = pgTable[\s\S]*tenantId: text\("tenant_id"\)/);
    assert.match(schemaSource, /customers_tenant_id_fkey/);
    assert.match(schemaSource, /customers_tenant_mode_email_idx/);
    assert.match(schemaSource, /customers_tenant_mode_archived_at_idx/);
    assert.match(schemaSource, /export const mandates = pgTable[\s\S]*tenantId: text\("tenant_id"\)/);
    assert.match(schemaSource, /mandates_tenant_id_fkey/);
    assert.match(schemaSource, /export const subscriptions = pgTable[\s\S]*tenantId: text\("tenant_id"\)/);
    assert.match(schemaSource, /subscriptions_tenant_id_fkey/);
    assert.match(schemaSource, /subscriptions_tenant_customer_idx/);
    assert.match(schemaSource, /export const subscriptionOperationRequests = pgTable[\s\S]*tenantId: text\("tenant_id"\)/);
    assert.match(schemaSource, /subscription_operation_requests_tenant_id_fkey/);
    assert.match(schemaSource, /subscription_operation_requests_unresolved_key/);
    assert.match(schemaSource, /export const payments = pgTable[\s\S]*tenantId: text\("tenant_id"\)/);
    assert.match(schemaSource, /payments_tenant_id_fkey/);
    assert.match(schemaSource, /payments_tenant_subscription_idx/);
    assert.match(schemaSource, /payments_tenant_recurring_collection_state_idx/);
    assert.match(schemaSource, /payments_tenant_invoice_state_idx/);
    assert.match(schemaSource, /export const recurringBillingSchedules = pgTable[\s\S]*tenantId: text\("tenant_id"\)/);
    assert.match(schemaSource, /recurring_billing_schedules_tenant_id_fkey/);
    assert.match(schemaSource, /recurring_billing_schedules_tenant_due_idx/);
    assert.match(schemaSource, /recurring_billing_schedules_tenant_subscription_idx/);
    assert.match(schemaSource, /export const paymentLinks = pgTable[\s\S]*tenantId: text\("tenant_id"\)/);
    assert.match(schemaSource, /payment_links_tenant_id_fkey/);
    assert.match(schemaSource, /payment_links_tenant_customer_idx/);
    assert.match(schemaSource, /export const subscriptionOnboardingConsents = pgTable[\s\S]*tenantId: text\("tenant_id"\)/);
    assert.match(schemaSource, /subscription_onboarding_consents_tenant_id_fkey/);
    assert.match(schemaSource, /subscription_onboarding_consents_tenant_customer_idx/);
    assert.match(schemaSource, /export const customerNotes = pgTable[\s\S]*tenantId: text\("tenant_id"\)/);
    assert.match(schemaSource, /customer_notes_tenant_id_fkey/);
    assert.match(schemaSource, /customer_notes_tenant_customer_created_idx/);
  });

  for (const migrationSource of migrationSources) {
    it("backfills a legacy bootstrap tenant and tenant_id columns", () => {
      assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS tenants/i);
      assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS platform_operators/i);
      assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS operator_tenant_memberships/i);
      assert.match(migrationSource, /INSERT INTO tenants[\s\S]*legacy-default/i);
      assert.match(migrationSource, /ALTER TABLE tenant_subscription_policy_defaults[\s\S]*ADD COLUMN IF NOT EXISTS tenant_id/i);
      assert.match(migrationSource, /ALTER TABLE tenant_billing_settings[\s\S]*ADD COLUMN IF NOT EXISTS tenant_id/i);
      assert.match(migrationSource, /UNIQUE \(tenant_id\)/i);
    });
  }

  it("backfills and rekeys core customer-linked tables by tenant", () => {
    const migrationSource = readFileSync(
      resolve("db/migrations/0018_tenant_scoped_business_tables.sql"),
      "utf8",
    );
    const drizzleSource = readFileSync(
      resolve("db/drizzle/0017_tenant_scoped_business_tables.sql"),
      "utf8",
    );

    for (const source of [migrationSource, drizzleSource]) {
      assert.match(source, /ALTER TABLE customers[\s\S]*ADD COLUMN IF NOT EXISTS tenant_id/i);
      assert.match(source, /ALTER TABLE mandates[\s\S]*ADD COLUMN IF NOT EXISTS tenant_id/i);
      assert.match(source, /ALTER TABLE subscriptions[\s\S]*ADD COLUMN IF NOT EXISTS tenant_id/i);
      assert.match(source, /ALTER TABLE subscription_operation_requests[\s\S]*ADD COLUMN IF NOT EXISTS tenant_id/i);
      assert.match(source, /ALTER TABLE payments[\s\S]*ADD COLUMN IF NOT EXISTS tenant_id/i);
      assert.match(source, /ALTER TABLE recurring_billing_schedules[\s\S]*ADD COLUMN IF NOT EXISTS tenant_id/i);
      assert.match(source, /ALTER TABLE payment_links[\s\S]*ADD COLUMN IF NOT EXISTS tenant_id/i);
      assert.match(source, /ALTER TABLE subscription_onboarding_consents[\s\S]*ADD COLUMN IF NOT EXISTS tenant_id/i);
      assert.match(source, /ALTER TABLE customer_notes[\s\S]*ADD COLUMN IF NOT EXISTS tenant_id/i);
      assert.match(source, /legacy-default/i);
      assert.match(source, /customers_tenant_mode_email_idx/i);
      assert.match(source, /subscription_operation_requests_unresolved_key/i);
      assert.match(source, /payments_tenant_invoice_state_idx/i);
      assert.match(source, /subscription_onboarding_consents_tenant_id_fkey/i);
      assert.match(source, /customer_notes_tenant_customer_created_idx/i);
    }
  });

  it("adds tenant-owned e-Boekhouden credential storage", () => {
    const migrationSource = readFileSync(
      resolve("db/migrations/0020_tenant_eboekhouden_credentials.sql"),
      "utf8",
    );
    const drizzleSource = readFileSync(
      resolve("db/drizzle/0019_tenant_eboekhouden_credentials.sql"),
      "utf8",
    );

    for (const source of [migrationSource, drizzleSource]) {
      assert.match(source, /tenant_eboekhouden_credentials/i);
      assert.match(source, /tenant_id/i);
      assert.match(source, /api_source/i);
      assert.match(source, /api_token_ciphertext/i);
      assert.match(source, /unique/i);
    }
  });
});
