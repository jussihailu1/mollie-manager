import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const source = readFileSync(resolve("lib/reliability/data.ts"), "utf8");

describe("reliability data tenant scope", () => {
  it("requires explicit tenant ids on dashboard reads", () => {
    assert.match(source, /listAlertInbox\(options: \{[\s\S]*mode\?: DashboardModeFilter;[\s\S]*tenantId: string;/);
    assert.match(source, /listRecentWebhookEvents\(options: \{[\s\S]*mode\?: DashboardModeFilter;[\s\S]*tenantId: string;/);
    assert.match(source, /listFailedWebhookEvents\(options: \{[\s\S]*limit\?: number;[\s\S]*mode\?: DashboardModeFilter;[\s\S]*tenantId: string;/);
    assert.match(source, /listRecentAuditActivity\(options: \{[\s\S]*mode\?: DashboardModeFilter;[\s\S]*tenantId: string;/);
    assert.doesNotMatch(source, /listAlertInbox\(options\?:/);
    assert.doesNotMatch(source, /listRecentWebhookEvents\(options\?:/);
    assert.doesNotMatch(source, /listFailedWebhookEvents\(options\?:/);
    assert.doesNotMatch(source, /listRecentAuditActivity\(options\?:/);
  });

  it("scopes alert inbox and snapshot reads to tenant-owned linked records", () => {
    assert.match(source, /p\.tenant_id = \$\{tenantId\}/);
    assert.match(source, /s\.tenant_id = \$\{tenantId\}/);
    assert.match(source, /customer\.tenant_id = \$\{tenantId\}/);
    assert.match(source, /fallback_customer\.tenant_id = \$\{tenantId\}/);
    assert.match(source, /or p\.id is not null/);
    assert.match(source, /or s\.id is not null/);
    assert.match(source, /await resolveTenantId\(options\?\.tenantId\)/);
  });

  it("keeps recent audit activity tied to tenant-linked alert, webhook, and cron rows", () => {
    assert.match(source, /entity_type = 'alert'/);
    assert.match(source, /entity_type = 'webhook_event'/);
    assert.match(source, /entity_type = 'tenant_recurring_billing_cron'/);
    assert.match(source, /webhook_events w/);
    assert.match(source, /alerts a/);
  });
});
