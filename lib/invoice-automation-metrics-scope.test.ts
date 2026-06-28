import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("invoice automation metrics tenant scope", () => {
  it("tracks cron heartbeat through the tenant cron audit entity", () => {
    const source = readFileSync(resolve("lib/invoice-automation-metrics.ts"), "utf8");

    assert.match(source, /tenant_recurring_billing_cron/);
    assert.match(source, /lastCronRunAt/);
    assert.match(source, /lastCronRunOutcome/);
    assert.match(source, /lastCronFailureAt/);
    assert.match(source, /lastCronSuccessAt/);
  });
});
