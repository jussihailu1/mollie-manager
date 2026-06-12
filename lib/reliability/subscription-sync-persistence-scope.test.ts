import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("subscription sync persistence module boundary", () => {
  it("moves subscription row persistence out of the sync orchestrator", () => {
    const operationsSource = readFileSync(
      resolve("lib/reliability/subscription-sync-operations.ts"),
      "utf8",
    );
    const persistenceSource = readFileSync(
      resolve("lib/reliability/subscription-sync-persistence.ts"),
      "utf8",
    );

    assert.match(
      operationsSource,
      /@\/lib\/reliability\/subscription-sync-persistence/,
    );
    assert.doesNotMatch(operationsSource, /update subscriptions/);
    assert.doesNotMatch(operationsSource, /upsertRecurringBillingScheduleForSubscription/);
    assert.match(persistenceSource, /update subscriptions/);
    assert.match(persistenceSource, /upsertRecurringBillingScheduleForSubscription/);
    assert.match(persistenceSource, /subscription\.sync/);
    assert.match(persistenceSource, /persistSyncedPayment/);
  });
});
