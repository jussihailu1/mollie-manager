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
    assert.match(
      source,
      /Shared reliability snapshot for \/settings and advanced \/api\/health/,
    );
    assert.match(source, /Open advanced diagnostics/);
    assert.match(source, /Failed webhook replay queue/);
    assert.match(source, /replayWebhookEventAction/);
    assert.match(source, /confirmMessage=\{`Replay failed/);
  });

  it("keeps billing settings available while advanced operations stay gated", () => {
    const settingsSource = readFileSync(
      resolve("app/(dashboard)/settings/page.tsx"),
      "utf8",
    );
    const reliabilityActionsSource = readFileSync(
      resolve("lib/reliability/actions.ts"),
      "utf8",
    );
    const billingActionsSource = readFileSync(
      resolve("lib/billing-actions.ts"),
      "utf8",
    );
    const authSource = readFileSync(resolve("lib/auth/session.ts"), "utf8");

    assert.match(settingsSource, /hasAdvancedOperationsAccess/);
    assert.match(settingsSource, /DeveloperSettingsToggle/);
    assert.match(settingsSource, /Billing and accounting configuration/);
    assert.match(settingsSource, /Recurring invoice accounting/);
    assert.match(reliabilityActionsSource, /requireAdvancedOperationsSession/);
    assert.match(billingActionsSource, /requireViewerSession/);
    assert.match(billingActionsSource, /requireAdvancedOperationsSession/);
    assert.match(authSource, /hasAdvancedOperationsAccess/);
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

  it("shares the same reliability ops snapshot between settings and health diagnostics", () => {
    const settingsSource = readFileSync(resolve("app/(dashboard)/settings/page.tsx"), "utf8");
    const healthSource = readFileSync(resolve("app/api/health/route.ts"), "utf8");

    assert.match(settingsSource, /getReliabilityOpsSnapshot/);
    assert.match(healthSource, /getReliabilityOpsSnapshot/);
    assert.match(healthSource, /opsSnapshot/);
  });

  it("gates billing follow-ups behind explicit full reconciliation mode", () => {
    const syncSource = readFileSync(resolve("lib/reliability/sync.ts"), "utf8");
    const modeSource = readFileSync(
      resolve("lib/reliability/reconciliation-mode.ts"),
      "utf8",
    );

    assert.match(modeSource, /export type ReconciliationMode = "full" \| "sync_only"/);
    assert.match(modeSource, /export function shouldRunBillingFollowups/);
    assert.match(modeSource, /export function formatReconciliationMode/);
    assert.doesNotMatch(syncSource, /function shouldRunBillingFollowups/);
    assert.match(syncSource, /shouldRunBillingFollowups/);
    assert.match(syncSource, /reconciliationMode = options\?\.reconciliationMode \?\? "full"/);
  });
});
