import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const repoRoot = process.cwd();

async function readRepoFile(filePath: string) {
  return readFile(path.join(repoRoot, filePath), "utf8");
}

test("needs attention query exposes stable typed sources without raw webhook payloads", async () => {
  const source = await readRepoFile("lib/reliability/needs-attention.ts");

  for (const itemType of [
    "customer_sync_stale",
    "eboekhouden_relation_problem",
    "expired_payment",
    "failed_payment",
    "failed_first_payment_invoice",
    "failed_invoice_delivery",
    "failed_recurring_invoice",
    "failed_webhook",
    "missing_mandate",
    "mandate_problem",
    "payment_action_required_subscription",
    "pending_subscription_cancellation",
    "payment_sync_stale",
    "reversed_payment",
    "subscription_out_of_sync",
    "subscription_sync_stale",
  ]) {
    assert.match(source, new RegExp(`['"]${itemType}['"]`));
  }

  assert.match(source, /recommendedAction/);
  assert.match(source, /listPendingSubscriptionOperationRequests/);
  assert.match(source, /tenantId: string/);
  assert.match(source, /p\.tenant_id = \$\{tenantId\}/);
  assert.match(source, /s\.tenant_id = \$\{tenantId\}/);
  assert.match(source, /c\.tenant_id = \$\{tenantId\}/);
  assert.match(source, /from payments p/);
  assert.match(source, /from subscriptions s/);
  assert.match(source, /from recurring_billing_schedules rbs/);
  assert.match(source, /from customers c/);
  assert.match(source, /from webhook_events w/);
  assert.match(source, /invoice_state = 'invoice_failed'/);
  assert.match(source, /invoiceDeliveryStatus/);
  assert.match(source, /last_synced_at/);
  assert.match(source, /eboekhouden_link_status/);
  assert.match(source, /w\.resource_id = p\.mollie_payment_id/);
  assert.match(source, /w\.resource_id = s\.mollie_subscription_id/);
  assert.match(source, /w\.resource_id = pl\.mollie_payment_link_id/);
  assert.doesNotMatch(source, /\bw\.payload\b/);
  assert.doesNotMatch(source, /secret|token|authorization/i);
  assert.doesNotMatch(source, /getSingleTenantIdOrThrow/);
});

test("normal dashboard and notifications use the shared needs attention query", async () => {
  const dashboard = await readRepoFile("app/(dashboard)/page.tsx");
  const notifications = await readRepoFile(
    "app/(dashboard)/notifications/page.tsx",
  );
  const uiData = await readRepoFile("lib/ui-data.ts");

  assert.match(
    dashboard,
    /@\/lib\/reliability\/needs-attention/,
  );
  assert.match(
    notifications,
    /@\/lib\/reliability\/needs-attention/,
  );
  assert.match(uiData, /recommendedAction/);
  assert.doesNotMatch(dashboard, /listOperationalAlerts/);
  assert.doesNotMatch(notifications, /listOperationalAlerts/);
});
