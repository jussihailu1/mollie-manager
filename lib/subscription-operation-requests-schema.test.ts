import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("subscription operation request schema", () => {
  const schemaSource = readFileSync(resolve("db/schema.ts"), "utf8");
  const migrationSources = [
    "db/migrations/0015_subscription_operation_requests.sql",
    "db/drizzle/0014_subscription_operation_requests.sql",
  ].map((path) => readFileSync(resolve(path), "utf8"));
  const consistencyMigrationSources = [
    "db/migrations/0016_subscription_cancellation_request_consistency.sql",
    "db/drizzle/0015_subscription_cancellation_request_consistency.sql",
  ].map((path) => readFileSync(resolve(path), "utf8"));

  it("models typed durable operation requests", () => {
    assert.match(schemaSource, /subscriptionOperationEnum/);
    assert.match(schemaSource, /subscriptionOperationRequestStatusEnum/);
    assert.match(schemaSource, /export const subscriptionOperationRequests = pgTable/);
    assert.match(schemaSource, /subscription_operation_requests_operator_reason_not_blank_check/);
    assert.match(schemaSource, /subscription_operation_requests_operator_reason_length_check/);
    assert.match(schemaSource, /subscription_operation_requests_cancellation_dates_check/);
  });

  for (const migrationSource of migrationSources) {
    it("enforces one unresolved request per subscription and operation", () => {
      assert.match(
        migrationSource,
        /CREATE UNIQUE INDEX[\s\S]*subscription_operation_requests_unresolved_key/i,
      );
      assert.match(
        migrationSource,
        /WHERE[\s\S]*status[\s\S]*IN \('pending', 'scheduled', 'processing'\)/i,
      );
      assert.match(migrationSource, /ON DELETE CASCADE/i);
      assert.match(migrationSource, /length\(btrim\([^)]*operator_reason[^)]*\)\) > 0/i);
      assert.doesNotMatch(migrationSource, /jsonb/i);
    });
  }

  for (const migrationSource of consistencyMigrationSources) {
    it("keeps cancellation reason and paid-period data consistent", () => {
      assert.match(migrationSource, /operator_reason[^;]*<= 1000/i);
      assert.match(migrationSource, /cancellation_effect[^;]*immediate/i);
      assert.match(migrationSource, /paid_period_end_at[^;]*IS NULL/i);
      assert.match(migrationSource, /end_of_paid_period/i);
      assert.match(migrationSource, /paid_period_end_at[^;]*IS NOT NULL/i);
      assert.match(
        migrationSource,
        /paid_period_end_at[^;]*>= ["']?requested_effective_at/i,
      );
    });
  }
});
