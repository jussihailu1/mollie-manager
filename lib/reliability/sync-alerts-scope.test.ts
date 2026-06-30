import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const syncSource = readFileSync("lib/reliability/sync.ts", "utf8");
const syncAlertsSource = readFileSync("lib/reliability/sync-alerts.ts", "utf8");

describe("sync alert module boundary", () => {
  it("keeps alert side effects out of the main sync orchestrator", () => {
    assert.match(syncSource, /@\/lib\/reliability\/sync-alerts/);
    assert.doesNotMatch(syncSource, /@\/lib\/reliability\/alerts/);
    assert.match(syncAlertsSource, /export async function handlePaymentAlerts/);
    assert.match(syncAlertsSource, /export async function handleSubscriptionAlerts/);
    assert.match(syncAlertsSource, /tenantId: string/);
    assert.match(syncAlertsSource, /tenantId: input\.tenantId/);
  });
});
