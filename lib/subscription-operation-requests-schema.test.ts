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

  it("models typed durable operation requests", () => {
    assert.match(schemaSource, /subscriptionOperationEnum/);
    assert.match(schemaSource, /subscriptionOperationRequestStatusEnum/);
    assert.match(schemaSource, /export const subscriptionOperationRequests = pgTable/);
    assert.match(schemaSource, /subscription_operation_requests_operator_reason_not_blank_check/);
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
});
