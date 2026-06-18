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
    "expired_payment",
    "failed_payment",
    "failed_webhook",
    "mandate_problem",
    "payment_action_required_subscription",
    "reversed_payment",
    "subscription_out_of_sync",
  ]) {
    assert.match(source, new RegExp(`['"]${itemType}['"]`));
  }

  assert.match(source, /recommendedAction/);
  assert.match(source, /from payments p/);
  assert.match(source, /from subscriptions s/);
  assert.match(source, /from webhook_events w/);
  assert.doesNotMatch(source, /\bw\.payload\b/);
  assert.doesNotMatch(source, /secret|token|authorization/i);
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
