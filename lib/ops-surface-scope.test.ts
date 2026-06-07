import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("ops surface hardening", () => {
  it("limits webhook replay to failed events in current mode", () => {
    const source = readFileSync(resolve("lib/reliability/actions.ts"), "utf8");

    assert.match(source, /processing_status as "processingStatus"/);
    assert.match(
      source,
      /Only failed webhook events in the current mode can be replayed\./,
    );
    assert.match(source, /event\.processingStatus !== "failed"/);
  });

  it("surfaces first-class operator diagnostics and replay controls in settings", () => {
    const source = readFileSync(resolve("app/(dashboard)/settings/page.tsx"), "utf8");

    assert.match(source, /Operations overview/);
    assert.match(source, /Open JSON diagnostics/);
    assert.match(source, /Failed webhook replay queue/);
    assert.match(source, /replayWebhookEventAction/);
  });

  it("defaults operator reconciliation to sync-only mode", () => {
    const source = readFileSync(resolve("app/(dashboard)/settings/page.tsx"), "utf8");

    assert.match(source, /name="reconciliationMode"/);
    assert.match(source, /defaultValue="sync_only"/);
    assert.match(source, /Sync-only: refresh Mollie state only/);
  });

  it("surfaces reconciliation invoice-state deltas in settings", () => {
    const settingsSource = readFileSync(
      resolve("app/(dashboard)/settings/page.tsx"),
      "utf8",
    );
    const actionSource = readFileSync(resolve("lib/reliability/actions.ts"), "utf8");

    assert.match(settingsSource, /Latest reconciliation result/);
    assert.match(settingsSource, /First-payment invoice state delta/);
    assert.match(settingsSource, /Recurring invoice state delta/);
    assert.match(settingsSource, /parseReconciliationSummary/);
    assert.match(actionSource, /reconciliationSummary/);
    assert.match(actionSource, /serializeReconciliationSummary/);
  });

  it("gates billing follow-ups behind explicit full reconciliation mode", () => {
    const source = readFileSync(resolve("lib/reliability/sync.ts"), "utf8");

    assert.match(source, /export type ReconciliationMode = "full" \| "sync_only"/);
    assert.match(source, /shouldRunBillingFollowups/);
    assert.match(source, /reconciliationMode = options\?\.reconciliationMode \?\? "full"/);
  });
});
