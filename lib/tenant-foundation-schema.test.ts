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
    assert.match(schemaSource, /tenant_subscription_policy_defaults_tenant_id_key/);
    assert.match(schemaSource, /tenant_billing_settings_tenant_id_key/);
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
});
