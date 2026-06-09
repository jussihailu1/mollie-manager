import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("sync persistence module boundary", () => {
  it("moves payment-row persistence out of the sync orchestrator", () => {
    const syncSource = readFileSync(resolve("lib/reliability/sync.ts"), "utf8");
    const persistenceSource = readFileSync(
      resolve("lib/reliability/sync-persistence.ts"),
      "utf8",
    );

    assert.match(syncSource, /@\/lib\/reliability\/sync-persistence/);
    assert.doesNotMatch(syncSource, /insert into payments/);
    assert.match(persistenceSource, /insert into payments/);
    assert.match(persistenceSource, /action: "payment\.sync"/);
    assert.match(persistenceSource, /upsertRecurringBillingScheduleForPayment/);
  });
});
